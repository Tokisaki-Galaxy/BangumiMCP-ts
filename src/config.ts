export interface RuntimeConfig {
  apiBaseUrl: string;
  userAgent: string;
  workerName: string;
  workerVersion: string;
  protocolVersion: string;
  enableIndexTools: boolean;
}

export interface RuntimeEnv {
  BANGUMI_API_BASE?: string;
  BANGUMI_USER_AGENT?: string;
  BANGUMI_ENABLE_INDEX_TOOLS?: string;
}

const DEFAULT_API_BASE_URL = "https://api.bgm.tv";
const DEFAULT_USER_AGENT = "Tokisaki-Galaxy/BangumiMCP-ts (https://github.com/Tokisaki-Galaxy/BangumiMCP-ts)";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function loadRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
  return {
    apiBaseUrl: trimTrailingSlash(env.BANGUMI_API_BASE ?? DEFAULT_API_BASE_URL),
    userAgent: env.BANGUMI_USER_AGENT ?? DEFAULT_USER_AGENT,
    workerName: "bangumi-mcp-ts",
    workerVersion: "0.1.0",
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    enableIndexTools: parseBoolean(env.BANGUMI_ENABLE_INDEX_TOOLS),
  };
}
