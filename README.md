# canvas.md

Open source collaborative markdown editor with AI and real-time collaboration.

## Features

- Real-time collaborative editing powered by Yjs CRDTs
- AI chat and AI-assisted document editing with Claude
- GitHub sync — link documents to repo files, pull updates, push as PRs
- Built-in MCP server for tool-driven integrations
- Inline comments with @claude mentions for AI-powered review

## Tech Stack

- [Next.js](https://nextjs.org) 16 + React 19 — frontend
- [Hono](https://hono.dev) — API server
- [Yjs](https://yjs.dev) + [Hocuspocus](https://tiptap.dev/hocuspocus) — real-time collaboration
- [Anthropic SDK](https://docs.anthropic.com) — AI chat and editing
- [PostgreSQL](https://www.postgresql.org) — persistence
- [MCP](https://modelcontextprotocol.io) — tool protocol for AI assistants

## Quick Start

1. Clone the repository:

```bash
git clone https://github.com/johndockery/canvas.md.git
cd canvas.md
```

2. Install dependencies:

```bash
npm install
```

3. Create a local Postgres database:

```bash
createdb canvas
```

4. Copy the example environment file and fill in your values:

```bash
cp .env.local.example .env.local
```

At minimum, set `DATABASE_URL` and `ANTHROPIC_API_KEY`. The defaults work for everything else in local dev.

5. Start the dev server:

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Description | Default |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string | — |
| `ANTHROPIC_API_KEY` | Yes | API key for Claude-powered chat and editing | — |
| `NEXT_PUBLIC_COLLAB_URL` | No | WebSocket URL for the collaboration server | `ws://localhost:1234` |
| `CANVAS_PUBLIC_URL` | No | Public base URL for the web app | `http://localhost:3000` |
| `PORT` | No | Port for the collaboration server | `1234` |
| `GITHUB_TOKEN` | No | GitHub token for repository integration | — |

## Architecture

```
┌─────────────────────────────────────────────┐
│  Next.js (port 3000)                        │
│  Editor UI, AI routes, comments, GitHub UI  │
├─────────────────────────────────────────────┤
│  Hono API (port 1235)         Hocuspocus    │
│  REST endpoints for           WebSocket     │
│  docs, comments, chat,        collab server │
│  GitHub proxy                 (port 1234)   │
├─────────────────────────────────────────────┤
│  PostgreSQL                                 │
│  Documents, comments, chat, GitHub links    │
└─────────────────────────────────────────────┘
```

**`server/routes.ts`** — Hono app with all API routes (documents, comments, chat, GitHub sync). Shared by both dev and production servers.

**`server/index.ts`** — Dev server. Runs Hocuspocus on port 1234 and the Hono API on port 1235.

**`server/production.ts`** — Production server. Runs everything (Next.js, Hono API, Hocuspocus, MCP) on a single port for environments like Cloud Run.

**`server/mcp.ts`** — MCP server exposing document tools. Runs via stdio for local AI assistants or via StreamableHTTP in production.

**`server/schema.sql`** — Database schema. Applied automatically on startup.

## MCP Server

canvas.md includes a [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants create, read, write, and manage documents programmatically.

### Available tools

| Tool | Description |
| --- | --- |
| `canvas_list_docs` | List all documents |
| `canvas_create_doc` | Create a new document (optionally linked to a GitHub repo/file) |
| `canvas_read_doc` | Read a document's markdown content |
| `canvas_write_doc` | Replace a document's content |
| `canvas_pull_doc` | Pull latest content (for syncing back to a local file) |
| `canvas_push_doc` | Push a document to GitHub as a PR |
| `canvas_update_title` | Update a document's title |
| `canvas_delete_doc` | Delete a document |
| `canvas_list_comments` | List comments on a document |
| `canvas_add_comment` | Add a comment to a document |

### Setup with Claude Code

Add to your `.claude/settings.json` or project settings:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["tsx", "/path/to/canvas.md/server/mcp.ts"],
      "env": {
        "CANVAS_API_URL": "http://localhost:1235"
      }
    }
  }
}
```

### Setup with Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["tsx", "/path/to/canvas.md/server/mcp.ts"],
      "env": {
        "CANVAS_API_URL": "http://localhost:1235"
      }
    }
  }
}
```

Make sure the canvas.md dev server is running (`npm run dev`) before using MCP tools.

## Contributing

Contributions are welcome. Open an issue to discuss significant changes before starting work, keep pull requests focused, and include tests or verification notes for behavior changes when possible.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
