import type { RuntimeConfig } from "./config";
import { parseRequestAuth } from "./lib/auth";
import { promptList, promptMap } from "./prompts";
import {
  resourceList,
  resourceMap,
  toolList,
  toolMap,
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

function findTool(name: string): ToolDefinition | undefined {
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
): Promise<ToolResponse> {
  const tool = findTool(name);
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
      const result = await callTool(params.name, args, context);
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
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      if (request.method !== "GET") {
        return new Response(null, { status: 405, headers: { Allow: "GET" } });
      }

      return jsonResponse({
        name: config.workerName,
        version: config.workerVersion,
        endpoint: "/mcp",
        transport: "streamable-http",
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
      const response = await handleJsonRpc(request, body, context);
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
