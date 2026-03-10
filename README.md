# Canvas Editor

Open source collaborative markdown editor with AI and real-time collaboration.

## Features

- Real-time collaborative editing powered by a shared Yjs document model
- AI chat and AI-assisted editing with Claude
- GitHub sync and repository browsing from the editor
- Built-in MCP server for tool-driven integrations
- Inline comments for collaborative review workflows

## Tech Stack

- Next.js 16 and React 19 for the web app
- Yjs and Hocuspocus for collaborative editing and presence
- Claude via the Anthropic SDK for AI features
- PostgreSQL for persistence and server-side data

## Quick Start

1. Clone the repository:

```bash
git clone https://github.com/your-org/canvas-editor.git
cd canvas-editor
```

2. Install dependencies:

```bash
npm install
```

3. Create a local Postgres database and update your connection string.

4. Copy the example environment file and fill in the required values:

```bash
cp .env.local.example .env.local
```

5. Start the app and collaboration server:

```bash
npm run dev
```

6. Open `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description | Example |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | API key for Claude-powered chat and editing. | `sk-ant-...` |
| `NEXT_PUBLIC_COLLAB_URL` | Yes | Public WebSocket URL for the collaboration server. | `ws://localhost:1234` |
| `DATABASE_URL` | Yes | PostgreSQL connection string for app and server data. | `postgresql://postgres:postgres@localhost:5432/canvas` |
| `CANVAS_PUBLIC_URL` | Yes | Public base URL for the Next.js app. | `http://localhost:3000` |
| `PORT` | Yes | Port for the collaboration/MCP server process. | `1234` |
| `GITHUB_TOKEN` | No | Optional server-side GitHub token for repository integration. | `github_pat_...` |

## Architecture

The app is split into two main runtime surfaces. The Next.js application in `src/` renders the editor UI, AI workflows, comments, and GitHub-facing features. The collaboration server in `server/` runs the shared document backend, persistence layer, and MCP endpoints used by external tools and automations.

Yjs provides the shared document model, while Hocuspocus handles real-time sync and presence over WebSockets. PostgreSQL stores durable state. Anthropic powers chat and edit flows. GitHub integration is handled server-side so the client can browse and sync repository content without embedding Git logic in the frontend.

## Contributing

Contributions are welcome. Open an issue to discuss significant changes before starting work, keep pull requests focused, and include tests or verification notes for behavior changes when possible.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

## MCP Server

Canvas includes a Model Context Protocol (MCP) server that lets AI assistants (Claude Code, Cursor, etc.) create, read, write, and manage documents programmatically.

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
      "args": ["tsx", "/path/to/canvas-editor/server/mcp.ts"],
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
      "args": ["tsx", "/path/to/canvas-editor/server/mcp.ts"],
      "env": {
        "CANVAS_API_URL": "http://localhost:1235"
      }
    }
  }
}
```

The MCP server connects to the Canvas API over HTTP. Make sure the Canvas dev server is running (`npm run dev`) before using MCP tools.
