/**
 * Production server: runs Next.js + Hocuspocus + REST API on a single port.
 * Cloud Run only exposes one port, so everything goes through here.
 */
import http from "node:http";
import { parse } from "node:url";
import next from "next";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server as HocuspocusServer } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { z } from "zod";
import {
  initDb,
  getDoc,
  upsertDoc,
  listDocs,
  getDocMeta,
  updateTitle,
  deleteDoc,
  getShareMode,
  setShareMode,
  addComment,
  getComments,
  deleteComments,
  getDocGitHubLinks,
  linkDocToRepo,
  unlinkDocFromRepo,
  deleteDocGitHubLinks,
  getDocFileLink,
  linkDocToFile,
  unlinkDocFile,
  updateFileSha,
  getChatMessages,
  addChatMessage,
  deleteChatMessages,
} from "./db.js";
import { markdownToYjs, yjsToMarkdown, yjsXmlFragmentToMarkdown } from "./markdown.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const dev = process.env.NODE_ENV !== "production";

// --- Hocuspocus ---
const hocuspocus = new HocuspocusServer({
  extensions: [
    new Database({
      async fetch({ documentName }) {
        const data = await getDoc(documentName);
        return data ?? null;
      },
      async store({ documentName, state }) {
        await upsertDoc(documentName, Buffer.from(state));
      },
    }),
  ],
  async onLoadDocument({ document: doc }) {
    // One-time migration: XmlFragment("default") → Y.Text("markdown")
    const ytext = doc.getText("markdown");
    if (ytext.length === 0) {
      const fragment = doc.getXmlFragment("default");
      if (fragment.length > 0) {
        const markdown = yjsXmlFragmentToMarkdown(fragment);
        if (markdown.trim()) {
          ytext.insert(0, markdown);
          console.log(`[collab] migrated XmlFragment → Y.Text for doc`);
        }
      }
    }
  },
  async onConnect({ documentName }) {
    console.log(`[collab] connected: ${documentName}`);
  },
  async onDisconnect({ documentName }) {
    console.log(`[collab] disconnected: ${documentName}`);
  },
});

// --- GitHub API helpers ---
const GITHUB_API = "https://api.github.com";

async function githubFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `GitHub API ${res.status}`);
  }
  return res.json();
}

function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

// --- Yjs helpers ---

// --- MCP over StreamableHTTP ---

const CANVAS_PUBLIC_URL = process.env.CANVAS_PUBLIC_URL || "http://localhost:3000";

function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "canvas",
      version: "0.1.0",
    },
    {
      instructions: `Canvas is a collaborative document editor. You have tools to create, read, write, and manage documents.

## Workflow: Creating markdown documents

When you create or draft a markdown document (e.g. a spec, RFC, planning doc, README), follow this workflow:

1. **Write the file locally** in the repo as you normally would (e.g. \`docs/planning.md\`).
2. **Also create it in Canvas** by calling \`canvas_create_doc\` with:
   - \`title\`: The document title
   - \`content\`: The same markdown content you wrote to the file
   - \`repo\`: The GitHub repo in \`owner/repo\` format (from the git remote)
   - \`filePath\`: The relative path of the file in the repo (e.g. \`docs/planning.md\`)
3. **Share the Canvas URL** with the user. The URL is returned by \`canvas_create_doc\` and has the format \`${CANVAS_PUBLIC_URL}/doc/{id}\`. This is the collaborative version where the team can comment, edit together in real-time, and use the AI chat sidebar.

## Workflow: Syncing changes back from Canvas

After the team has reviewed and edited the document in Canvas (comments addressed, content refined), sync the latest version back to the local repo:

1. Call \`canvas_pull_doc\` with the document ID to get the latest markdown content from Canvas.
2. Write the returned content to the local file, replacing the old version.
3. Commit the changes.

## Key rules

- The Canvas URL path is \`/doc/{id}\`, NOT \`/document/{id}\`.
- Always pass \`repo\` and \`filePath\` when creating docs so they stay linked.
- Canvas renders markdown: headings, bold, italic, code blocks, lists, blockquotes all work.`,
    },
  );

  server.tool(
    "canvas_list_docs",
    `List all documents in Canvas. Returns each document's ID, title, timestamps, and collaborative URL. The URL format is always ${CANVAS_PUBLIC_URL}/doc/{id}.`,
    {},
    async () => {
      const docs = (await listDocs()).map((doc: Record<string, unknown>) => ({
        ...doc,
        url: `${CANVAS_PUBLIC_URL}/doc/${doc.name}`,
      }));
      return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
    }
  );

  server.tool(
    "canvas_create_doc",
    `Create a new rich-text document in Canvas. Content should be markdown — headings, bold, italic, code blocks, lists, and blockquotes will all render properly in the editor. Optionally link to a GitHub repo and file path so the doc is born connected — enabling push-to-PR via canvas_push_doc. Returns the new document's ID and collaborative URL (format: ${CANVAS_PUBLIC_URL}/doc/{id}). IMPORTANT: The URL path is /doc/ not /document/.`,
    {
      title: z.string().describe("Title for the new document"),
      content: z.string().optional().describe("Markdown content for the document body. Supports headings (#), bold (**), italic (*), code blocks (```), lists (- or 1.), blockquotes (>), and horizontal rules (---)."),
      name: z.string().optional().describe("Optional ID/slug for the document URL. Auto-generated UUID if omitted."),
      repo: z.string().optional().describe("GitHub repo in 'owner/repo' format. When provided with filePath, the doc is linked to this repo file for push/pull."),
      filePath: z.string().optional().describe("File path in the repo (e.g. 'docs/api-spec.md'). Required together with repo to enable GitHub linking."),
    },
    async ({ title, content, name: docName, repo, filePath }) => {
      const name = docName || crypto.randomUUID();
      const ydoc = new Y.Doc();
      if (content) {
        markdownToYjs(content, ydoc.getText("markdown"));
      }
      const state = Y.encodeStateAsUpdate(ydoc);
      await upsertDoc(name, Buffer.from(state));
      ydoc.destroy();
      await updateTitle(title, name);

      if (repo && filePath) {
        await linkDocToFile(name, repo, filePath, null);
      }

      const lines = [
        `Created document "${title}" with ID: ${name}`,
        `URL: ${CANVAS_PUBLIC_URL}/doc/${name}`,
      ];
      if (repo && filePath) {
        lines.push(`Linked to GitHub: ${repo}/${filePath}`);
        lines.push(`Use canvas_push_doc with docId "${name}" to push changes as a PR.`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "canvas_push_doc",
    "Push a Canvas document to GitHub as a pull request. The doc must have been created with repo and filePath params (or linked manually in Canvas). Returns the PR URL on success.",
    {
      docId: z.string().describe("The document ID to push to GitHub"),
    },
    async ({ docId }) => {
      // Read the doc content and file link to push via GitHub API
      const fileLink = await getDocFileLink(docId);
      if (!fileLink) {
        return { content: [{ type: "text", text: "Error: No file linked to this document.\n\nHint: Create the doc with repo and filePath params to enable push, or link it manually in Canvas." }] };
      }

      const data = await getDoc(docId);
      if (!data) {
        return { content: [{ type: "text", text: "Error: Document not found" }] };
      }

      let markdown = "";
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, new Uint8Array(data));
      const ytext = ydoc.getText("markdown");
      if (ytext.length > 0) {
        markdown = ytext.toString();
      } else {
        const fragment = ydoc.getXmlFragment("default");
        if (fragment.length > 0) {
          markdown = yjsToMarkdown(fragment);
        }
      }
      ydoc.destroy();

      if (!markdown) {
        return { content: [{ type: "text", text: "Error: Document is empty, nothing to push." }] };
      }

      // Use the internal github-push route logic so MCP follows the same code path.
      const internalUrl = `http://localhost:${PORT}/api/canvas/docs/${docId}/github-push`;
      try {
        const res = await fetch(internalUrl, { method: "POST" });
        const result = await res.json() as Record<string, string>;
        if (!res.ok) {
          let guidance = `Error: ${result.error || res.statusText}`;
          if (result.error?.includes("GitHub")) {
            guidance += "\n\nHint: Set GITHUB_TOKEN on the server to enable GitHub operations.";
          }
          return { content: [{ type: "text", text: guidance }] };
        }
        const lines = [`Pushed document ${docId} to GitHub.`];
        if (result.prUrl) lines.push(`PR: ${result.prUrl}`);
        if (result.commitSha) lines.push(`Commit: ${result.commitSha}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error pushing to GitHub: ${(err as Error).message}` }] };
      }
    }
  );

  server.tool(
    "canvas_read_doc",
    `Read a Canvas document's content as markdown along with its metadata (title, ID, URL, timestamps). The body is returned in markdown format preserving headings, bold, italic, code blocks, lists, etc.`,
    { docId: z.string().describe("The document ID (the 'name' field from canvas_list_docs)") },
    async ({ docId }) => {
      const meta = await getDocMeta(docId);
      if (!meta) return { content: [{ type: "text", text: "Error: Not found" }] };
      const data = await getDoc(docId);
      let markdown = "";
      if (data) {
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, new Uint8Array(data));
        // Try new Y.Text format first, fall back to old XmlFragment
        const ytext = ydoc.getText("markdown");
        if (ytext.length > 0) {
          markdown = ytext.toString();
        } else {
          const fragment = ydoc.getXmlFragment("default");
          if (fragment.length > 0) {
            markdown = yjsToMarkdown(fragment);
          }
        }
        ydoc.destroy();
      }
      return {
        content: [{
          type: "text",
          text: `Title: ${meta.title}\nID: ${meta.name}\nURL: ${CANVAS_PUBLIC_URL}/doc/${meta.name}\nCreated: ${meta.created_at}\nUpdated: ${meta.updated_at}\n\n---\n\n${markdown || "(empty document)"}`,
        }],
      };
    }
  );

  server.tool(
    "canvas_update_title",
    "Update the title of an existing Canvas document.",
    {
      docId: z.string().describe("The document ID"),
      title: z.string().describe("New title for the document"),
    },
    async ({ docId, title }) => {
      await updateTitle(title, docId);
      return { content: [{ type: "text", text: `Updated title of ${docId} to "${title}"` }] };
    }
  );

  server.tool(
    "canvas_write_doc",
    "Replace the full body of a Canvas document with new markdown content. Supports headings (#), bold (**), italic (*), code blocks (```), lists (- or 1.), blockquotes (>), and horizontal rules (---). This overwrites all existing content.",
    {
      docId: z.string().describe("The document ID"),
      content: z.string().describe("New markdown content for the document body"),
    },
    async ({ docId, content }) => {
      const connection = await hocuspocus.hocuspocus.openDirectConnection(docId);
      await connection.transact((doc) => {
        markdownToYjs(content, doc.getText("markdown"));
      });
      await connection.disconnect();
      return { content: [{ type: "text", text: `Wrote ${content.length} chars to document ${docId}\nURL: ${CANVAS_PUBLIC_URL}/doc/${docId}` }] };
    }
  );

  server.tool(
    "canvas_pull_doc",
    "Pull the latest markdown content from a Canvas document. Use this to sync collaborative changes back to a local file. Returns just the markdown body — write it directly to the local file to complete the sync.",
    {
      docId: z.string().describe("The document ID to pull content from"),
    },
    async ({ docId }) => {
      const meta = await getDocMeta(docId);
      if (!meta) return { content: [{ type: "text", text: "Error: Not found" }] };
      const data = await getDoc(docId);
      let markdown = "";
      if (data) {
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, new Uint8Array(data));
        const ytext = ydoc.getText("markdown");
        if (ytext.length > 0) {
          markdown = ytext.toString();
        } else {
          const fragment = ydoc.getXmlFragment("default");
          if (fragment.length > 0) {
            markdown = yjsToMarkdown(fragment);
          }
        }
        ydoc.destroy();
      }
      return {
        content: [{
          type: "text",
          text: markdown || "(empty document)",
        }],
      };
    }
  );

  server.tool(
    "canvas_delete_doc",
    "Permanently delete a Canvas document and all its comments.",
    { docId: z.string().describe("The document ID to delete") },
    async ({ docId }) => {
      await deleteDoc(docId);
      await deleteComments(docId);
      await deleteChatMessages(docId);
      await deleteDocGitHubLinks(docId);
      return { content: [{ type: "text", text: `Deleted document ${docId}` }] };
    }
  );

  server.tool(
    "canvas_list_comments",
    "List all comments on a Canvas document. Returns each comment's ID, author, text, and timestamp.",
    { docId: z.string().describe("The document ID") },
    async ({ docId }) => {
      const comments = await getComments(docId);
      return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
    }
  );

  server.tool(
    "canvas_add_comment",
    "Add a comment to a Canvas document. Comments appear in the sidebar next to the document.",
    {
      docId: z.string().describe("The document ID"),
      text: z.string().describe("The comment text"),
      userName: z.string().optional().describe("Display name for the commenter. Defaults to 'Claude'."),
      isAgent: z.boolean().optional().describe("Whether this comment is from an AI agent. Defaults to true."),
    },
    async ({ docId, text, userName, isAgent }) => {
      const id = crypto.randomUUID();
      await addComment(id, docId, userName || "Claude", text, isAgent ?? true, null, null, null, null);
      return { content: [{ type: "text", text: `Added comment to document ${docId}` }] };
    }
  );

  return server;
}

function readRawBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      if (!body) return resolve(undefined);
      try { resolve(JSON.parse(body)); } catch { reject(new Error("Malformed JSON")); }
    });
  });
}

function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (url.pathname !== "/mcp") return false;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, last-event-id");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }

  // Stateless mode: create a fresh server+transport per request.
  // This avoids session tracking entirely, which is ideal for Cloud Run
  // where instances restart and in-memory state is lost.
  if (req.method === "GET" || req.method === "DELETE") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
    return true;
  }

  (async () => {
    const body = await readRawBody(req);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  })().catch((err) => {
    console.error("[mcp]", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MCP error" }));
    }
  });

  return true;
}

// --- Router helper ---

type RouteHandler = (
  ctx: RouteContext
) => Promise<void> | void;

interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: string[];
  json: (data: unknown, status?: number) => void;
  readBody: () => Promise<Record<string, unknown>>;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

const routes: Route[] = [];

function route(method: string, pattern: string, handler: RouteHandler) {
  // Convert "/api/canvas/docs/:id/comments" → regex with capture groups
  const regexStr = "^" + pattern.replace(/:([^/]+)/g, "([^/]+)").replace(/\(\+\)/g, "(.+)") + "$";
  routes.push({ method, pattern: new RegExp(regexStr), handler });
}

// ============================================================
// Document CRUD
// ============================================================

// Open — list docs
route("GET", "/api/canvas/docs", async ({ json }) => {
  json({ docs: await listDocs() });
});

route("POST", "/api/canvas/docs", async ({ json, readBody }) => {
  const body = await readBody();
  const name = (body.name as string) || crypto.randomUUID();
  const title = (body.title as string) || "Untitled";
  const content = (body.content as string) || "";

  const ydoc = new Y.Doc();
  if (content) {
    markdownToYjs(content, ydoc.getText("markdown"));
  }
  const state = Y.encodeStateAsUpdate(ydoc);
  await upsertDoc(name, Buffer.from(state));
  ydoc.destroy();

  await updateTitle(title, name);

  const repoFullName = body.repoFullName as string | undefined;
  const filePath = body.filePath as string | undefined;
  if (repoFullName && filePath) {
    await linkDocToFile(name, repoFullName, filePath, null);
  }

  json({ name, title }, 201);
});

// Open — get doc meta
route("GET", "/api/canvas/docs/:id", async ({ params, json }) => {
  const meta = await getDocMeta(params[0]);
  if (!meta) return json({ error: "Not found" }, 404);
  json(meta);
});

route("PUT", "/api/canvas/docs/:id", async ({ params, json, readBody }) => {
  const body = await readBody();
  if (!body.title || typeof body.title !== "string") {
    return json({ error: "Missing required field: title" }, 400);
  }
  await updateTitle(body.title, params[0]);
  json({ ok: true });
});

route("DELETE", "/api/canvas/docs/:id", async ({ params, json }) => {
  const docName = params[0];
  await deleteDoc(docName);
  await deleteComments(docName);
  await deleteChatMessages(docName);
  await deleteDocGitHubLinks(docName);
  json({ ok: true });
});

// ============================================================
// Sharing
// ============================================================

// Open — get share mode
route("GET", "/api/canvas/docs/:id/sharing", async ({ params, json }) => {
  const mode = await getShareMode(params[0]);
  json({ mode });
});

route("PUT", "/api/canvas/docs/:id/sharing", async ({ params, json, readBody }) => {
  const body = await readBody();
  const mode = body.mode as string;
  if (!mode || !["none", "view", "edit"].includes(mode)) {
    return json({ error: "Invalid mode. Must be none, view, or edit." }, 400);
  }
  await setShareMode(params[0], mode);
  json({ ok: true, mode });
});

// ============================================================
// Content (markdown read/write)
// ============================================================

// Open — read content as markdown
route("GET", "/api/canvas/docs/:id/content", async ({ params, json }) => {
  const data = await getDoc(params[0]);
  if (!data) return json({ content: "" });
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, new Uint8Array(data));
  // Try new Y.Text format first, fall back to old XmlFragment
  const ytext = ydoc.getText("markdown");
  let markdown: string;
  if (ytext.length > 0) {
    markdown = ytext.toString();
  } else {
    const fragment = ydoc.getXmlFragment("default");
    markdown = fragment.length > 0 ? yjsToMarkdown(fragment) : "";
  }
  ydoc.destroy();
  json({ content: markdown });
});

route("PUT", "/api/canvas/docs/:id/content", async ({ params, json, readBody }) => {
  const docName = params[0];
  const body = await readBody();
  const markdown = (body.content as string) || "";

  const connection = await hocuspocus.hocuspocus.openDirectConnection(docName);
  await connection.transact((doc) => {
    markdownToYjs(markdown, doc.getText("markdown"));
  });
  await connection.disconnect();
  json({ ok: true });
});

// ============================================================
// Comments
// ============================================================

// Open — list comments
route("GET", "/api/canvas/docs/:id/comments", async ({ params, json }) => {
  json({ comments: await getComments(params[0]) });
});

route("POST", "/api/canvas/docs/:id/comments", async ({ params, json, readBody }) => {
  const body = await readBody();
  if (!body.text || typeof body.text !== "string") {
    return json({ error: "Missing required field: text" }, 400);
  }

  const id = crypto.randomUUID();
  await addComment(
    id, params[0],
    (body.userName as string) || "Anonymous",
    body.text,
    !!body.isAgent,
    (body.anchorQuote as string) || null,
    (body.anchorContext as string) || null,
    body.anchorFrom != null ? (body.anchorFrom as number) : null,
    body.anchorTo != null ? (body.anchorTo as number) : null,
    body.editActions ?? undefined
  );
  json({ id }, 201);
});

// ============================================================
// Chat messages
// ============================================================

// Open — list chat messages
route("GET", "/api/canvas/docs/:id/chat", async ({ params, json }) => {
  json({ messages: await getChatMessages(params[0]) });
});

route("POST", "/api/canvas/docs/:id/chat", async ({ params, json, readBody }) => {
  const body = await readBody();
  if (!body.id || !body.role || typeof body.content !== "string") {
    return json({ error: "Missing required fields: id, role, content" }, 400);
  }

  await addChatMessage(
    body.id as string,
    params[0],
    body.role as string,
    body.content,
    body.editActions ?? undefined
  );
  json({ ok: true }, 201);
});

// ============================================================
// Doc-GitHub links
// ============================================================

// Open — list linked repos
route("GET", "/api/canvas/docs/:id/github", async ({ params, json }) => {
  json({ links: await getDocGitHubLinks(params[0]) });
});

route("POST", "/api/canvas/docs/:id/github", async ({ params, json, readBody }) => {
  const body = await readBody();
  if (!body.repoFullName || typeof body.repoFullName !== "string") {
    return json({ error: "Missing required field: repoFullName" }, 400);
  }
  await linkDocToRepo(params[0], body.repoFullName, (body.defaultBranch as string) || null);
  json({ ok: true }, 201);
});

route("DELETE", "/api/canvas/docs/:id/github/:owner/:repo", async ({ params, json }) => {
  await unlinkDocFromRepo(params[0], `${params[1]}/${params[2]}`);
  json({ ok: true });
});

// ============================================================
// GitHub browse proxy (for AI agent tools)
// ============================================================

route("GET", "/api/canvas/github/browse/:owner/:repo/tree", async ({ url, params, json }) => {
  const repoFullName = `${params[0]}/${params[1]}`;
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);
  const dirPath = url.searchParams.get("path") || "";
  try {
    const contents = await githubFetch(
      `/repos/${repoFullName}/contents/${dirPath}`,
      ghToken
    );
    if (Array.isArray(contents)) {
      json({
        items: contents.map((item: Record<string, unknown>) => ({
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size,
        })),
      });
    } else {
      json({ items: [{ name: contents.name, path: contents.path, type: contents.type, size: contents.size }] });
    }
  } catch (err) {
    json({ error: (err as Error).message || "Failed to list directory" }, 500);
  }
});

route("GET", "/api/canvas/github/browse/:owner/:repo/file", async ({ url, params, json }) => {
  const repoFullName = `${params[0]}/${params[1]}`;
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);
  const filePath = url.searchParams.get("path") || "";
  if (!filePath) return json({ error: "Missing path parameter" }, 400);
  try {
    const fileData = await githubFetch(
      `/repos/${repoFullName}/contents/${filePath}`,
      ghToken
    );
    let content = "";
    if (fileData.encoding === "base64" && fileData.content) {
      content = Buffer.from(fileData.content as string, "base64").toString("utf-8");
    }
    // Truncate to 10K characters
    if (content.length > 10000) {
      content = content.slice(0, 10000) + "\n\n... [truncated at 10,000 characters]";
    }
    json({ path: filePath, content });
  } catch (err) {
    json({ error: (err as Error).message || "Failed to read file" }, 500);
  }
});

route("GET", "/api/canvas/github/browse/:owner/:repo/search", async ({ url, params, json }) => {
  const repoFullName = `${params[0]}/${params[1]}`;
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);
  const query = url.searchParams.get("q") || "";
  if (!query) return json({ error: "Missing q parameter" }, 400);
  try {
    const searchResult = await githubFetch(
      `/search/code?q=${encodeURIComponent(query)}+repo:${repoFullName}&per_page=5`,
      ghToken
    );
    const results = (searchResult.items || []).map((item: Record<string, unknown>) => ({
      path: item.path,
      name: item.name,
      html_url: item.html_url,
    }));
    json({ results, total_count: searchResult.total_count || 0 });
  } catch (err) {
    json({ error: (err as Error).message || "Search failed" }, 500);
  }
});

// ============================================================
// GitHub API proxy (read)
// ============================================================

route("GET", "/api/canvas/github/repos", async ({ json }) => {
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);
  const repos = await githubFetch("/user/repos?sort=updated&per_page=30", ghToken);
  json({
    repos: repos.map((r: Record<string, unknown>) => ({
      full_name: r.full_name,
      name: r.name,
      owner: (r.owner as Record<string, unknown>)?.login,
      description: r.description,
      default_branch: r.default_branch,
      private: r.private,
      updated_at: r.updated_at,
      html_url: r.html_url,
    })),
  });
});

route("GET", "/api/canvas/github/repos/:owner/:repo/contents", async ({ url, params, json }) => {
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);
  const [owner, repo] = params;
  const filePath = url.searchParams.get("path") || "";
  const ref = url.searchParams.get("ref") || "";
  const ghPath = `/repos/${owner}/${repo}/contents/${filePath}${ref ? `?ref=${ref}` : ""}`;
  const contents = await githubFetch(ghPath, ghToken);
  if (Array.isArray(contents)) {
    return json({
      items: contents.map((item: Record<string, unknown>) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
      })),
    });
  }
  json({
    name: contents.name,
    path: contents.path,
    type: contents.type,
    size: contents.size,
    sha: contents.sha,
    content: contents.encoding === "base64" && contents.content
      ? Buffer.from(contents.content as string, "base64").toString("utf-8")
      : null,
  });
});

route("GET", "/api/canvas/github/repos/:owner/:repo/branches", async ({ params, json }) => {
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);
  const [owner, repo] = params;
  const branches = await githubFetch(`/repos/${owner}/${repo}/branches?per_page=30`, ghToken);
  json({
    branches: branches.map((b: Record<string, unknown>) => ({
      name: b.name,
      sha: (b.commit as Record<string, unknown>)?.sha,
    })),
  });
});

// ============================================================
// GitHub /docs markdown sync
// ============================================================

route("GET", "/api/canvas/github/repos/:owner/:repo/docs-files", async ({ url, params, json }) => {
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);
  const [owner, repo] = params;
  const subpath = url.searchParams.get("path") || "";
  const dirPath = subpath ? `docs/${subpath}` : "docs";
  try {
    const contents = await githubFetch(`/repos/${owner}/${repo}/contents/${dirPath}`, ghToken);
    if (Array.isArray(contents)) {
      const items = contents
        .filter((item: Record<string, unknown>) => {
          if (item.type === "dir") return true;
          return item.type === "file" && typeof item.name === "string" && (item.name as string).endsWith(".md");
        })
        .map((item: Record<string, unknown>) => ({
          name: String(item.name),
          path: String(item.path),
          type: item.type as "file" | "dir",
          sha: item.sha,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return json({ items, path: subpath });
    }
    json({ items: [], path: subpath });
  } catch {
    json({ items: [], path: subpath });
  }
});

route("POST", "/api/canvas/github/docs-import", async ({ json, readBody }) => {
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);

  const body = await readBody();
  const repoFullName = body.repoFullName as string;
  const filePath = body.filePath as string;
  const fileSha = body.fileSha as string;
  if (!repoFullName || !filePath) {
    return json({ error: "Missing repoFullName or filePath" }, 400);
  }

  const [owner, repo] = repoFullName.split("/");
  const fileData = await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, ghToken);
  const markdownContent = fileData.encoding === "base64" && fileData.content
    ? Buffer.from(fileData.content as string, "base64").toString("utf-8")
    : "";

  // Derive title from filename
  const fileName = filePath.split("/").pop() || filePath;
  const title = fileName.replace(/\.md$/i, "").replace(/[-_]/g, " ");

  // Create Yjs doc with markdown content
  const docName = crypto.randomUUID();
  const ydoc = new Y.Doc();
  markdownToYjs(markdownContent, ydoc.getText("markdown"));
  const state = Y.encodeStateAsUpdate(ydoc);
  await upsertDoc(docName, Buffer.from(state));
  ydoc.destroy();

  await updateTitle(title, docName);
  await linkDocToFile(docName, repoFullName, filePath, fileSha || fileData.sha);

  json({ docName, title }, 201);
});

// Open — get file link info for a doc
route("GET", "/api/canvas/docs/:id/github-file", async ({ params, json }) => {
  const link = await getDocFileLink(params[0]);
  if (!link) return json({ linked: false });
  json({
    linked: true,
    repo_full_name: link.repo_full_name,
    file_path: link.file_path,
    file_sha: link.file_sha,
    last_synced_at: link.last_synced_at,
  });
});

route("POST", "/api/canvas/docs/:id/github-pull", async ({ params, json }) => {
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);

  const docName = params[0];
  const link = await getDocFileLink(docName);
  if (!link) return json({ error: "No file linked" }, 404);

  const [owner, repo] = link.repo_full_name.split("/");
  const fileData = await githubFetch(`/repos/${owner}/${repo}/contents/${link.file_path}`, ghToken);
  const markdownContent = fileData.encoding === "base64" && fileData.content
    ? Buffer.from(fileData.content as string, "base64").toString("utf-8")
    : "";

  // Use Hocuspocus direct connection to apply changes live
  const connection = await hocuspocus.hocuspocus.openDirectConnection(docName);
  await connection.transact((doc) => {
    markdownToYjs(markdownContent, doc.getText("markdown"));
  });
  await connection.disconnect();

  await updateFileSha(docName, fileData.sha);
  json({ ok: true, sha: fileData.sha });
});

route("POST", "/api/canvas/docs/:id/github-push", async ({ params, json }) => {
  const ghToken = getGitHubToken();
  if (!ghToken) return json({ error: "GitHub not connected" }, 401);

  const docName = params[0];
  const link = await getDocFileLink(docName);
  if (!link) return json({ error: "No file linked" }, 404);

  // Load Yjs doc and convert to markdown
  const data = await getDoc(docName);
  if (!data) return json({ error: "Document not found" }, 404);

  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, new Uint8Array(data));
  // Try new Y.Text format first, fall back to old XmlFragment
  const pushYtext = ydoc.getText("markdown");
  let markdown: string;
  if (pushYtext.length > 0) {
    markdown = pushYtext.toString();
  } else {
    const fragment = ydoc.getXmlFragment("default");
    markdown = fragment.length > 0 ? yjsToMarkdown(fragment) : "";
  }
  ydoc.destroy();

  const [owner, repo] = link.repo_full_name.split("/");

  // 1. Get the repo's default branch
  const repoInfo = await githubFetch(`/repos/${owner}/${repo}`, ghToken);
  const defaultBranch = repoInfo.default_branch || "main";

  // 2. Get the latest commit SHA of the default branch
  const refData = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, ghToken);
  const baseSha = refData.object?.sha;
  if (!baseSha) return json({ error: "Could not resolve default branch" }, 500);

  // 3. Create a new branch
  const fileName = link.file_path.split("/").pop()?.replace(/\.md$/i, "") || "doc";
  const timestamp = Date.now().toString(36);
  const branchName = `canvas/${fileName}-${timestamp}`;
  await githubFetch(`/repos/${owner}/${repo}/git/refs`, ghToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    }),
  });

  // 4. Get the current file SHA from the new branch (matches default branch at this point)
  let currentFileSha = link.file_sha;
  try {
    const fileInfo = await githubFetch(
      `/repos/${owner}/${repo}/contents/${link.file_path}?ref=${branchName}`,
      ghToken
    );
    currentFileSha = fileInfo.sha;
  } catch {
    // Use stored SHA as fallback
  }

  // 5. Commit the file update to the new branch
  const commitMessage = `Update ${link.file_path} from Canvas`;
  const result = await githubFetch(`/repos/${owner}/${repo}/contents/${link.file_path}`, ghToken, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(markdown).toString("base64"),
      sha: currentFileSha,
      branch: branchName,
    }),
  });

  // 6. Create a PR
  const pr = await githubFetch(`/repos/${owner}/${repo}/pulls`, ghToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: commitMessage,
      body: `Updated via [Canvas](${CANVAS_PUBLIC_URL})`,
      head: branchName,
      base: defaultBranch,
    }),
  });

  // Update the stored SHA to the new file SHA
  if (result.content?.sha) {
    await updateFileSha(docName, result.content.sha);
  }

  json({
    ok: true,
    pr_number: pr.number,
    pr_url: pr.html_url,
    branch: branchName,
  });
});

route("DELETE", "/api/canvas/docs/:id/github-file", async ({ params, json }) => {
  await unlinkDocFile(params[0]);
  json({ ok: true });
});

// --- REST API handler ---
function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (!path.startsWith("/api/canvas/")) return false;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  const json = (data: unknown, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  const readBody = (): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("Malformed JSON"));
        }
      });
    });

  (async () => {
    try {
      const method = req.method || "GET";

      for (const r of routes) {
        if (r.method !== method) continue;
        const match = path.match(r.pattern);
        if (!match) continue;

        const params = match.slice(1);
        await r.handler({ req, res, url, params, json, readBody });
        return;
      }

      json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof Error && err.message === "Malformed JSON") {
        return json({ error: "Malformed JSON in request body" }, 400);
      }
      console.error("[api]", err);
      json({ error: "Internal server error" }, 500);
    }
  })();

  return true;
}

// --- Next.js ---
const app = next({ dev, dir: process.cwd() });
const handle = app.getRequestHandler();

async function main() {
  await initDb();
  await app.prepare();

  const server = http.createServer((req, res) => {
    if (handleMcp(req, res)) return;
    if (handleApi(req, res)) return;
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/collab")) {
      const docName = url.pathname.slice("/collab/".length) || "default";
      wss.handleUpgrade(req, socket, head, (ws) => {
        hocuspocus.hocuspocus.handleConnection(ws, req, docName);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, () => {
    console.log(`[canvas] Server running on http://localhost:${PORT}`);
    console.log(`[canvas] WebSocket at ws://localhost:${PORT}/collab`);
    console.log(`[canvas] API at http://localhost:${PORT}/api/canvas/docs`);
    console.log(`[canvas] MCP at http://localhost:${PORT}/mcp`);
  });
}

main().catch((err) => {
  console.error("[canvas] Failed to start:", err);
  process.exit(1);
});
