# bangumiMCP-ts

Bangumi MCP 的 TypeScript 重写仓库。

## Docs

- `docs/requirements.md`
- `docs/bangumi-tv-api.json`

## Usage

```bash
bun install
bun run dev
```

Worker 入口：

- `GET /` 返回状态信息
- `POST /mcp` 处理 MCP JSON-RPC

请求认证：

- 通过 `Authorization: Bearer <token>` 传递 Bangumi token
- 兼容 `AUTHTOKEN` 头

环境变量：

- `BANGUMI_API_BASE`
- `BANGUMI_USER_AGENT`
