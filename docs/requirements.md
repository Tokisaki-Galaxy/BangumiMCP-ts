# Requirements

## Problem

现有 Python Worker 依赖体积过大，免费版 Cloudflare Workers 超过 3MB 后无法部署。

## Scope

- Public MCP endpoint on Cloudflare Workers
- `Authorization: Bearer <token>` per request
- No token persistence
- Public read-only Bangumi tools
- Auth-required write tools
- Keep local dev workflow lightweight

## Out of scope

- Python Worker packaging
- Vendored `python_modules/`
- Any server-side token storage

## Design notes

- Use TypeScript for the Worker runtime
- Keep Bangumi API access in a thin fetch wrapper
- Separate auth, API client, tool registration, and worker entrypoint
