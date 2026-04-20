import { loadRuntimeConfig } from "./config";
import { createMcpHandler } from "./mcp";

export interface Env {
  BANGUMI_API_BASE?: string;
  BANGUMI_USER_AGENT?: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const config = loadRuntimeConfig(env);
    const handler = createMcpHandler(config);
    return handler(request);
  },
};
