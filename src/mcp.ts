import type { RuntimeConfig } from "./config";
import { parseRequestAuth } from "./lib/auth";
import { promptList, promptMap } from "./prompts";
import {
  resourceList,
  resourceMap,
  createToolRegistry,
  type ToolContext,
  type ToolDefinition,
  type ToolResponse,
} from "./tools";

const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);

const MCP_CAPABILITIES = {
  tools: {
    listChanged: false,
  },
  resources: {
    listChanged: false,
    subscribe: false,
  },
  prompts: {
    listChanged: false,
  },
} as const;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function jsonResponse(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).jsonrpc === "2.0" &&
    typeof (value as Record<string, unknown>).method === "string"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolResult(response: ToolResponse): unknown {
  return {
    content: [
      {
        type: "text",
        text: response.text,
      },
    ],
    isError: !response.ok,
  };
}

function parseProtocolVersion(request: Request, params: unknown): string {
  const headerVersion = request.headers.get("MCP-Protocol-Version");
  if (headerVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(headerVersion)) {
    throw new Error(`Unsupported MCP protocol version: ${headerVersion}`);
  }

  const paramVersion = asRecord(params)?.protocolVersion;
  if (typeof paramVersion === "string" && paramVersion.length > 0) {
    if (!SUPPORTED_PROTOCOL_VERSIONS.has(paramVersion)) {
      throw new Error(`Unsupported MCP protocol version: ${paramVersion}`);
    }
    return paramVersion;
  }

  if (headerVersion) {
    return headerVersion;
  }

  return "2025-03-26";
}

function findTool(name: string, toolMap: Map<string, ToolDefinition>): ToolDefinition | undefined {
  return toolMap.get(name);
}

function findResource(uri: string) {
  return resourceMap.get(uri);
}

function findPrompt(name: string) {
  return promptMap.get(name);
}

async function callTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
  toolMap: Map<string, ToolDefinition>,
): Promise<ToolResponse> {
  const tool = findTool(name, toolMap);
  if (!tool) {
    return { ok: false, text: `Unknown tool: ${name}` };
  }

  if (tool.requiresAuth && !context.authToken) {
    return {
      ok: false,
      text: "This tool requires Authorization: Bearer <token> on the request.",
    };
  }

  return tool.handler(input, context);
}

async function handleJsonRpc(
  request: Request,
  rpc: JsonRpcRequest,
  context: ToolContext,
  toolList: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
  toolMap: Map<string, ToolDefinition>,
): Promise<JsonRpcResponse> {
  const id = rpc.id ?? null;

  switch (rpc.method) {
    case "initialize": {
      const protocolVersion = parseProtocolVersion(request, rpc.params);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          serverInfo: {
            name: context.config.workerName,
            version: context.config.workerVersion,
          },
          capabilities: MCP_CAPABILITIES,
        },
      };
    }

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: toolList },
      };

    case "tools/call": {
      const params = asRecord(rpc.params);
      if (!params || typeof params.name !== "string") {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "tools/call requires a tool name." },
        };
      }

      const args = asRecord(params.arguments) ?? {};
      const result = await callTool(params.name, args, context, toolMap);
      return {
        jsonrpc: "2.0",
        id,
        result: toolResult(result),
      };
    }

    case "resources/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { resources: resourceList },
      };

    case "resources/read": {
      const params = asRecord(rpc.params);
      const uri = typeof params?.uri === "string" ? params.uri : undefined;
      if (!uri) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "resources/read requires a uri." },
        };
      }

      const resource = findResource(uri);
      if (!resource) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown resource: ${uri}` },
        };
      }

      const text = await resource.read();
      return {
        jsonrpc: "2.0",
        id,
        result: {
          contents: [
            {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text,
            },
          ],
        },
      };
    }

    case "prompts/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { prompts: promptList },
      };

    case "prompts/get": {
      const params = asRecord(rpc.params);
      const name = typeof params?.name === "string" ? params.name : undefined;
      if (!name) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "prompts/get requires a prompt name." },
        };
      }

      const prompt = findPrompt(name);
      if (!prompt) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown prompt: ${name}` },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        result: {
          description: prompt.description,
          messages: prompt.messages,
        },
      };
    }

    case "ping":
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${rpc.method}` },
      };
  }
}

export function createMcpHandler(config: RuntimeConfig) {
  const { toolList, toolMap } = createToolRegistry(config);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      if (request.method !== "GET") {
        return new Response(null, { status: 405, headers: { Allow: "GET" } });
      }

      const tools: Array<{ name: string; desc: string }> = [
        { name: "search", desc: "Aggregated search for subjects, persons, and characters." },
        { name: "get_subject", desc: "Subject details with expandable includes (persons, characters, relations, episodes)." },
        { name: "get_user_profile", desc: "User profile only." },
        { name: "get_user_collections", desc: "User collection snapshot with page_size as a 20-50 sliding range or all, plus offset, subject_type/collection_type/subject_id filters." },
        { name: "get_calendar", desc: "Weekly broadcast schedule." },
        { name: "update_collection", desc: "Write entry for subject/person/character/episode collection updates." },
        { name: "browse_subjects", desc: "Browse the subject catalog by type with cat/year/month/sort filters." },
        { name: "get_collections", desc: "Person/character collection lists and individual lookups." },
        { name: "get_episode", desc: "Episode details, single/collection list episode collection status." },
        { name: "get_image", desc: "Image URL redirects for subject/person/character/user." },
        { name: "get_person", desc: "Person details plus related works and characters." },
        { name: "get_character", desc: "Character details plus appearances and voice actors." },
        { name: "manage_index", desc: "Index (directory) CRUD and collection management (requires BANGUMI_ENABLE_INDEX_TOOLS)." },
      ];

      const toolRows = tools.map((t) => `<tr><td class=\"name\">${t.name}</td><td>${t.desc}</td></tr>`).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bangumi MCP TS</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.6rem; margin-bottom: 0.2rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  p { line-height: 1.6; }
  a { color: #0366d6; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  td { padding: 6px 10px; border-bottom: 1px solid #e8e8e8; vertical-align: top; }
  .name { font-weight: 600; white-space: nowrap; width: 1%; }
  .endpoint { background: #fff3cd; padding: 4px 10px; border-radius: 4px; font-family: monospace; }
  .footer { margin-top: 2.5rem; font-size: 0.85rem; color: #666; }
</style>
</head>
<body>
<h1>Bangumi MCP TS</h1>
<p>A <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server for the <a href="https://bgm.tv">Bangumi</a> API, deployable on Cloudflare Workers. Provides programmatic access to anime, book, music, game, and real-world media data.</p>
<p>
  <strong>MCP endpoint:</strong> <code class="endpoint">POST /mcp</code> (streamable HTTP)<br>
  <strong>Source:</strong> <a href="https://github.com/tokisaki-galaxy/bangumiMCP-ts">github.com/tokisaki-galaxy/bangumiMCP-ts</a><br>
  <strong>Inspired by:</strong> <a href="https://github.com/Ukenn2112/BangumiMCP">Ukenn2112/BangumiMCP</a>
</p>
<h2>Tools (${tools.length})</h2>
<table>${toolRows}</table>
<p class="footer">${config.workerName} v${config.workerVersion}</p>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "GET") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }

    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST, GET" } });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Request body must be valid JSON.");
    }

    const auth = parseRequestAuth(request);
    const context: ToolContext = {
      authToken: auth.token,
      config,
    };

    if (!isJsonRpcRequest(body)) {
      const rpc = asRecord(body);
      if (rpc && typeof rpc.method === "string" && rpc.id === undefined) {
        return new Response(null, { status: 202 });
      }

      return errorResponse("Body must be a JSON-RPC request.", 400);
    }

    if (body.id === undefined || body.id === null) {
      return new Response(null, { status: 202 });
    }

    try {
      const response = await handleJsonRpc(request, body, context, toolList, toolMap);
      return jsonResponse(response, 200, {
        "MCP-Protocol-Version": parseProtocolVersion(request, body.params),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unsupported MCP protocol version")) {
        return errorResponse(error.message, 400);
      }

      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32603,
            message: "Internal server error.",
            data: error instanceof Error ? error.message : String(error),
          },
        },
        500,
      );
    }
  };
}
