# Bangumi MCP TS

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" />
  <img src="https://img.shields.io/badge/MCP-111827?style=for-the-badge&logoColor=white" alt="Model Context Protocol" />
  <img src="https://img.shields.io/badge/Bangumi-FFD866?style=for-the-badge&logoColor=111827" alt="Bangumi API" />
</p>

一个部署在 Cloudflare Workers 上的 Bangumi MCP 服务器，提供对 Bangumi API 的程序化访问。

## 特性

- **55 个 MCP tools**：覆盖条目、人物、角色、用户、收藏、目录、编辑历史
- **1 个 MCP resource**：内置 Bangumi OpenAPI 文档
- **1 个 MCP prompt**：Bangumi 使用提示
- **无状态设计**：每个请求单独携带 `Authorization: Bearer <token>`
- **Cloudflare Worker 运行**：适合公开部署和边缘访问

感谢 [Bangumi MCP](https://github.com/Ukenn2112/BangumiMCP) 为本项目提供的思路。功能一致，微调了tools的说明以压缩上下文。目标皆在将本地MCP服务器部署到 Cloudflare Workers 上。

![image](https://github.com/user-attachments/assets/f315ba06-d057-4e64-9699-895febe92ed9)

## 快速开始

官方 MCP 服务器（流式HTTP）地址：
https://bgm.api.tski.uk/mcp

因为可能需要传递个人令牌，基于cloudflare免费版本的使用量和安全考虑，请谨慎使用非官方提供的 MCP 服务器。**建议自行部署**，以下是部署指南。

需求：
- Cloudflare账号

### 一键部署

点击下面按钮即可

[![deploy](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tokisaki-galaxy/bangumiMCP-ts)

PS：也可以通过fork到自己的账户，cloudflare连接到github存储库

### 本地开发

```bash
bun install
bun run dev
```

默认会启动 Wrangler dev，入口为：

- `GET /`：状态信息
- `POST /mcp`：MCP JSON-RPC 入口

### 部署到 Cloudflare

```bash
bun run deploy
```

## 认证方式

不认证可以使用绝大多数功能，但是写操作和部分受限接口需要请求级认证，详细描述见[Bangumi MCP](https://github.com/Ukenn2112/BangumiMCP)。

```http
Authorization: Bearer <your_token>
```

兼容 `AUTHTOKEN` 头。也可以使用以下认证方式：

```http
AUTHTOKEN: <your_token>
```

## 可用能力

### Tools

- 条目：搜索、浏览、详情、图片、相关人物/角色/章节/关系、章节信息
- 人物：搜索、详情、图片、相关条目/角色
- 角色：搜索、详情、图片、相关条目/人物
- 用户：资料、头像、当前用户
- 收藏：条目、章节、人物、角色、目录
- 目录：创建、更新、查询、增删条目
- 编辑历史：条目、章节、人物、角色

### Resource

- `bangumi://openapi`：Bangumi OpenAPI 规范

### Prompt

- `bangumi-usage`：Bangumi MCP 使用提示

## 环境变量

| 变量 | 说明 |
|---|---|
| `BANGUMI_API_BASE` | Bangumi API 基础地址，默认 `https://api.bgm.tv` |
| `BANGUMI_USER_AGENT` | 请求使用的 User-Agent |

## 项目结构

```text
bangumiMCP-ts/
├── src/
│   ├── index.ts
│   ├── mcp.ts
│   ├── config.ts
│   ├── prompts.ts
│   ├── tools.ts
│   └── lib/
├── docs/
│   ├── requirements.md
│   └── bangumi-tv-api.json
└── wrangler.jsonc
```

## 说明

- 重点目标是保持 Worker 轻量、无状态、易部署
- 公开工具优先，写操作通过请求头传 token

### 相关项目与致谢

- **[Ukenn2112/BangumiMCP](https://github.com/Ukenn2112/BangumiMCP)** - Local implementation of BangumiMCP
