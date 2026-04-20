export interface RuntimeConfig {
  apiBaseUrl: string;
  userAgent: string;
  workerName: string;
  workerVersion: string;
  protocolVersion: string;
}

export interface RuntimeEnv {
  BANGUMI_API_BASE?: string;
  BANGUMI_USER_AGENT?: string;
}

const DEFAULT_API_BASE_URL = "https://api.bgm.tv";
const DEFAULT_USER_AGENT = "bangumi-mcp-ts/0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function loadRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
  return {
    apiBaseUrl: trimTrailingSlash(env.BANGUMI_API_BASE ?? DEFAULT_API_BASE_URL),
    userAgent: env.BANGUMI_USER_AGENT ?? DEFAULT_USER_AGENT,
    workerName: "bangumi-mcp-ts",
    workerVersion: "0.1.0",
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
  };
}
