import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type CreateMcpServerOptions = {
  apiUrl?: string;
  publicUrl?: string;
};

async function api(apiUrl: string, path: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${apiUrl}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error || `HTTP ${res.status}` };
  }
  return res.json();
}

export function createMcpServer(options: CreateMcpServerOptions = {}) {
  const apiUrl = options.apiUrl || process.env.CANVAS_API_URL || "http://localhost:1235";
  const publicUrl = options.publicUrl || process.env.CANVAS_PUBLIC_URL || apiUrl;

  const server = new McpServer(
    {
      name: "canvas-md",
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
3. **Share the Canvas URL** with the user. The URL is returned by \`canvas_create_doc\` and has the format \`${publicUrl}/doc/{id}\`. This is the collaborative version where the team can comment, edit together in real-time, and use the AI chat sidebar.

## Workflow: Syncing changes back from Canvas

After the team has reviewed and edited the document in Canvas (comments addressed, content refined), sync the latest version back to the local repo:

1. Call \`canvas_pull_doc\` with the document ID to get the latest markdown content from Canvas.
2. Write the returned content to the local file, replacing the old version.
3. Commit the changes.

## Key rules

- The Canvas URL path is \`/doc/{id}\`, NOT \`/document/{id}\`.
- Always pass \`repo\` and \`filePath\` when creating docs so they stay linked.
- Canvas renders markdown: headings, bold, italic, code blocks, lists, blockquotes all work.`,
    }
  );

  server.tool(
    "canvas_list_docs",
    `List all documents in Canvas. Returns each document's ID, title, timestamps, and collaborative URL. The URL format is always ${publicUrl}/doc/{id}.`,
    {},
    async () => {
      const data = await api(apiUrl, "/api/canvas/docs");
      const docs = (data.docs || []).map((doc: Record<string, unknown>) => ({
        ...doc,
        url: `${publicUrl}/doc/${doc.name}`,
      }));
      return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
    }
  );

  server.tool(
    "canvas_create_doc",
    `Create a new rich-text document in Canvas. Content should be markdown — headings, bold, italic, code blocks, lists, and blockquotes will all render properly in the editor. Optionally link to a GitHub repo and file path so the doc is born connected — enabling push-to-PR via canvas_push_doc. Returns the new document's ID and collaborative URL (format: ${publicUrl}/doc/{id}). IMPORTANT: The URL path is /doc/ not /document/.`,
    {
      title: z.string().describe("Title for the new document"),
      content: z.string().optional().describe("Markdown content for the document body. Supports headings (#), bold (**), italic (*), code blocks (```), lists (- or 1.), blockquotes (>), and horizontal rules (---)."),
      name: z.string().optional().describe("Optional ID/slug for the document URL. Auto-generated UUID if omitted."),
      repo: z.string().optional().describe("GitHub repo in 'owner/repo' format. When provided with filePath, the doc is linked to this repo file for push/pull."),
      filePath: z.string().optional().describe("File path in the repo (e.g. 'docs/api-spec.md'). Required together with repo to enable GitHub linking."),
    },
    async ({ title, content, name, repo, filePath }) => {
      const data = await api(apiUrl, "/api/canvas/docs", {
        method: "POST",
        body: JSON.stringify({
          title,
          content,
          name,
          repoFullName: repo,
          filePath,
        }),
      });
      if (data.error) {
        return { content: [{ type: "text", text: `Error: ${data.error}` }] };
      }

      const lines = [`Created document "${title}" with ID: ${data.name}`, `URL: ${publicUrl}/doc/${data.name}`];
      if (repo && filePath) {
        lines.push(`Linked to GitHub: ${repo}/${filePath}`);
        lines.push(`Use canvas_push_doc with docId "${data.name}" to push changes as a PR.`);
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
      const data = await api(apiUrl, `/api/canvas/docs/${docId}/github-push`, { method: "POST" });
      if (data.error) {
        let guidance = `Error: ${data.error}`;
        if (data.error.includes("GitHub")) {
          guidance += "\n\nHint: Set GITHUB_TOKEN on the server to enable GitHub operations.";
        }
        if (
          data.error.includes("No file linked") ||
          data.error.includes("not linked") ||
          data.error.includes("Not found")
        ) {
          guidance += "\n\nHint: Create the doc with repo and filePath params to enable push, or link it manually in Canvas.";
        }
        return { content: [{ type: "text", text: guidance }] };
      }

      const lines = [`Pushed document ${docId} to GitHub.`];
      if (data.prUrl || data.pr_url) lines.push(`PR: ${data.prUrl || data.pr_url}`);
      if (data.commitSha || data.commit_sha) lines.push(`Commit: ${data.commitSha || data.commit_sha}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "canvas_read_doc",
    "Read a Canvas document's content as markdown along with its metadata (title, ID, URL, timestamps). The body is returned in markdown format preserving headings, bold, italic, code blocks, lists, etc.",
    { docId: z.string().describe("The document ID (the 'name' field from canvas_list_docs)") },
    async ({ docId }) => {
      const [meta, body] = await Promise.all([
        api(apiUrl, `/api/canvas/docs/${docId}`),
        api(apiUrl, `/api/canvas/docs/${docId}/content`),
      ]);
      if (meta.error) {
        return { content: [{ type: "text", text: `Error: ${meta.error}` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: `Title: ${meta.title}\nID: ${meta.name}\nURL: ${publicUrl}/doc/${meta.name}\nCreated: ${meta.created_at}\nUpdated: ${meta.updated_at}\n\n---\n\n${body.content || "(empty document)"}`,
          },
        ],
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
      await api(apiUrl, `/api/canvas/docs/${docId}`, {
        method: "PUT",
        body: JSON.stringify({ title }),
      });
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
      await api(apiUrl, `/api/canvas/docs/${docId}/content`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      return {
        content: [{ type: "text", text: `Wrote ${content.length} chars to document ${docId}\nURL: ${publicUrl}/doc/${docId}` }],
      };
    }
  );

  server.tool(
    "canvas_pull_doc",
    "Pull the latest markdown content from a Canvas document. Use this to sync collaborative changes back to a local file. Returns just the markdown body — write it directly to the local file to complete the sync.",
    {
      docId: z.string().describe("The document ID to pull content from"),
    },
    async ({ docId }) => {
      const [meta, body] = await Promise.all([
        api(apiUrl, `/api/canvas/docs/${docId}`),
        api(apiUrl, `/api/canvas/docs/${docId}/content`),
      ]);
      if (meta.error) {
        return { content: [{ type: "text", text: `Error: ${meta.error}` }] };
      }
      return { content: [{ type: "text", text: body.content || "(empty document)" }] };
    }
  );

  server.tool(
    "canvas_delete_doc",
    "Permanently delete a Canvas document and all its comments.",
    {
      docId: z.string().describe("The document ID to delete"),
    },
    async ({ docId }) => {
      await api(apiUrl, `/api/canvas/docs/${docId}`, { method: "DELETE" });
      return { content: [{ type: "text", text: `Deleted document ${docId}` }] };
    }
  );

  server.tool(
    "canvas_list_comments",
    "List all comments on a Canvas document. Returns each comment's ID, author, text, and timestamp.",
    {
      docId: z.string().describe("The document ID"),
    },
    async ({ docId }) => {
      const data = await api(apiUrl, `/api/canvas/docs/${docId}/comments`);
      return { content: [{ type: "text", text: JSON.stringify(data.comments, null, 2) }] };
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
      await api(apiUrl, `/api/canvas/docs/${docId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          text,
          userName: userName || "Claude",
          isAgent: isAgent ?? true,
        }),
      });
      return { content: [{ type: "text", text: `Added comment to document ${docId}` }] };
    }
  );

  return server;
}

export async function main() {
  const transport = new StdioServerTransport();
  const server = createMcpServer();
  await server.connect(transport);
  console.error("[canvas-mcp] MCP server running on stdio");
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
