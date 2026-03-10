import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import * as Y from "yjs";
import {
  addChatMessage,
  addComment,
  deleteChatMessages,
  deleteComments,
  deleteDoc,
  deleteDocGitHubLinks,
  getChatMessages,
  getComments,
  getDoc,
  getDocFileLink,
  getDocGitHubLinks,
  getDocMeta,
  getShareMode,
  linkDocToFile,
  linkDocToRepo,
  listDocs,
  setShareMode,
  unlinkDocFile,
  unlinkDocFromRepo,
  updateFileSha,
  updateTitle,
  upsertDoc,
} from "./db.js";
import { markdownToYjs, yjsToMarkdown } from "./markdown.js";

const GITHUB_API = "https://api.github.com";

type HocuspocusLike = {
  hocuspocus: {
    openDirectConnection: (
      documentName: string
    ) => Promise<{
      transact: (callback: (doc: Y.Doc) => void | Promise<void>) => Promise<void>;
      disconnect: () => Promise<void>;
    }>;
  };
};

type GitHubContentFile = {
  content?: string;
  encoding?: string;
  html_url?: string;
  name?: string;
  path?: string;
  sha?: string;
  size?: number;
  type?: string;
};

type GitHubContentItem = GitHubContentFile | GitHubContentFile[];

function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

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

async function readJsonBody(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw new HTTPException(400, { message: "Malformed JSON in request body" });
  }
}

function requireGitHubToken() {
  const token = getGitHubToken();
  if (!token) {
    throw new HTTPException(401, { message: "GitHub not connected" });
  }
  return token;
}

function decodeGitHubContent(fileData: GitHubContentFile): string {
  if (fileData.encoding === "base64" && fileData.content) {
    return Buffer.from(fileData.content, "base64").toString("utf-8");
  }
  return "";
}

async function withDirectConnection(
  hocuspocus: HocuspocusLike,
  docName: string,
  callback: (doc: Y.Doc) => void | Promise<void>
) {
  const connection = await hocuspocus.hocuspocus.openDirectConnection(docName);
  try {
    await connection.transact(callback);
  } finally {
    await connection.disconnect();
  }
}

export function createRoutes(hocuspocus: HocuspocusLike) {
  const app = new Hono();

  app.use("/api/canvas/*", cors());

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error("[api]", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/api/canvas/docs", async (c) => {
    return c.json({ docs: await listDocs() });
  });

  app.post("/api/canvas/docs", async (c) => {
    const body = await readJsonBody(c);
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

    return c.json({ name, title }, 201);
  });

  app.get("/api/canvas/docs/:id", async (c) => {
    const meta = await getDocMeta(c.req.param("id"));
    if (!meta) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(meta);
  });

  app.put("/api/canvas/docs/:id", async (c) => {
    const body = await readJsonBody(c);
    if (!body.title || typeof body.title !== "string") {
      return c.json({ error: "Missing required field: title" }, 400);
    }
    await updateTitle(body.title, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.delete("/api/canvas/docs/:id", async (c) => {
    const docName = c.req.param("id");
    await deleteDoc(docName);
    await deleteComments(docName);
    await deleteChatMessages(docName);
    await deleteDocGitHubLinks(docName);
    return c.json({ ok: true });
  });

  app.get("/api/canvas/docs/:id/sharing", async (c) => {
    return c.json({ mode: await getShareMode(c.req.param("id")) });
  });

  app.put("/api/canvas/docs/:id/sharing", async (c) => {
    const body = await readJsonBody(c);
    const mode = body.mode as string;
    if (!mode || !["none", "view", "edit"].includes(mode)) {
      return c.json({ error: "Invalid mode. Must be none, view, or edit." }, 400);
    }
    await setShareMode(c.req.param("id"), mode);
    return c.json({ ok: true, mode });
  });

  app.get("/api/canvas/docs/:id/content", async (c) => {
    const data = await getDoc(c.req.param("id"));
    if (!data) {
      return c.json({ content: "" });
    }

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(data));
    const ytext = ydoc.getText("markdown");
    const fragment = ydoc.getXmlFragment("default");
    const markdown = ytext.length > 0 ? ytext.toString() : fragment.length > 0 ? yjsToMarkdown(fragment) : "";
    ydoc.destroy();

    return c.json({ content: markdown });
  });

  app.put("/api/canvas/docs/:id/content", async (c) => {
    const body = await readJsonBody(c);
    const markdown = (body.content as string) || "";

    await withDirectConnection(hocuspocus, c.req.param("id"), (doc) => {
      markdownToYjs(markdown, doc.getText("markdown"));
    });

    return c.json({ ok: true });
  });

  app.get("/api/canvas/docs/:id/comments", async (c) => {
    return c.json({ comments: await getComments(c.req.param("id")) });
  });

  app.post("/api/canvas/docs/:id/comments", async (c) => {
    const body = await readJsonBody(c);
    if (!body.text || typeof body.text !== "string") {
      return c.json({ error: "Missing required field: text" }, 400);
    }

    const id = crypto.randomUUID();
    await addComment(
      id,
      c.req.param("id"),
      (body.userName as string) || "Anonymous",
      body.text,
      !!body.isAgent,
      (body.anchorQuote as string) || null,
      (body.anchorContext as string) || null,
      body.anchorFrom != null ? (body.anchorFrom as number) : null,
      body.anchorTo != null ? (body.anchorTo as number) : null,
      body.editActions ?? undefined
    );

    return c.json({ id }, 201);
  });

  app.get("/api/canvas/docs/:id/chat", async (c) => {
    return c.json({ messages: await getChatMessages(c.req.param("id")) });
  });

  app.post("/api/canvas/docs/:id/chat", async (c) => {
    const body = await readJsonBody(c);
    if (!body.id || !body.role || typeof body.content !== "string") {
      return c.json({ error: "Missing required fields: id, role, content" }, 400);
    }

    await addChatMessage(
      body.id as string,
      c.req.param("id"),
      body.role as string,
      body.content,
      body.editActions ?? undefined
    );

    return c.json({ ok: true }, 201);
  });

  app.get("/api/canvas/docs/:id/github", async (c) => {
    return c.json({ links: await getDocGitHubLinks(c.req.param("id")) });
  });

  app.post("/api/canvas/docs/:id/github", async (c) => {
    const body = await readJsonBody(c);
    if (!body.repoFullName || typeof body.repoFullName !== "string") {
      return c.json({ error: "Missing required field: repoFullName" }, 400);
    }
    await linkDocToRepo(
      c.req.param("id"),
      body.repoFullName,
      (body.defaultBranch as string) || null
    );
    return c.json({ ok: true }, 201);
  });

  app.delete("/api/canvas/docs/:id/github/:owner/:repo", async (c) => {
    await unlinkDocFromRepo(c.req.param("id"), `${c.req.param("owner")}/${c.req.param("repo")}`);
    return c.json({ ok: true });
  });

  app.get("/api/canvas/github/browse/:owner/:repo/tree", async (c) => {
    const ghToken = requireGitHubToken();
    const repoFullName = `${c.req.param("owner")}/${c.req.param("repo")}`;
    const dirPath = c.req.query("path") || "";

    try {
      const contents = (await githubFetch(
        `/repos/${repoFullName}/contents/${dirPath}`,
        ghToken
      )) as GitHubContentItem;

      if (Array.isArray(contents)) {
        return c.json({
          items: contents.map((item) => ({
            name: item.name,
            path: item.path,
            type: item.type,
            size: item.size,
          })),
        });
      }

      return c.json({
        items: [
          {
            name: contents.name,
            path: contents.path,
            type: contents.type,
            size: contents.size,
          },
        ],
      });
    } catch (err) {
      return c.json({ error: (err as Error).message || "Failed to list directory" }, 500);
    }
  });

  app.get("/api/canvas/github/browse/:owner/:repo/file", async (c) => {
    const ghToken = requireGitHubToken();
    const repoFullName = `${c.req.param("owner")}/${c.req.param("repo")}`;
    const filePath = c.req.query("path") || "";
    if (!filePath) {
      return c.json({ error: "Missing path parameter" }, 400);
    }

    try {
      const fileData = (await githubFetch(
        `/repos/${repoFullName}/contents/${filePath}`,
        ghToken
      )) as GitHubContentFile;
      let content = decodeGitHubContent(fileData);
      if (content.length > 10000) {
        content = `${content.slice(0, 10000)}\n\n... [truncated at 10,000 characters]`;
      }
      return c.json({ path: filePath, content });
    } catch (err) {
      return c.json({ error: (err as Error).message || "Failed to read file" }, 500);
    }
  });

  app.get("/api/canvas/github/browse/:owner/:repo/search", async (c) => {
    const ghToken = requireGitHubToken();
    const repoFullName = `${c.req.param("owner")}/${c.req.param("repo")}`;
    const query = c.req.query("q") || "";
    if (!query) {
      return c.json({ error: "Missing q parameter" }, 400);
    }

    try {
      const searchResult = await githubFetch(
        `/search/code?q=${encodeURIComponent(query)}+repo:${repoFullName}&per_page=5`,
        ghToken
      );
      const items = (searchResult.items || []) as GitHubContentFile[];
      return c.json({
        results: items.map((item) => ({
          path: item.path,
          name: item.name,
          html_url: item.html_url,
        })),
        total_count: searchResult.total_count || 0,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message || "Search failed" }, 500);
    }
  });

  app.get("/api/canvas/github/repos", async (c) => {
    const ghToken = requireGitHubToken();
    const repos = await githubFetch("/user/repos?sort=updated&per_page=30", ghToken);
    return c.json({
      repos: repos.map((repo: Record<string, unknown>) => ({
        full_name: repo.full_name,
        name: repo.name,
        owner: (repo.owner as Record<string, unknown>)?.login,
        description: repo.description,
        default_branch: repo.default_branch,
        private: repo.private,
        updated_at: repo.updated_at,
        html_url: repo.html_url,
      })),
    });
  });

  app.get("/api/canvas/github/repos/:owner/:repo/contents", async (c) => {
    const ghToken = requireGitHubToken();
    const filePath = c.req.query("path") || "";
    const ref = c.req.query("ref") || "";
    const ghPath = `/repos/${c.req.param("owner")}/${c.req.param("repo")}/contents/${filePath}${ref ? `?ref=${ref}` : ""}`;
    const contents = (await githubFetch(ghPath, ghToken)) as GitHubContentItem;

    if (Array.isArray(contents)) {
      return c.json({
        items: contents.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size,
          sha: item.sha,
        })),
      });
    }

    return c.json({
      name: contents.name,
      path: contents.path,
      type: contents.type,
      size: contents.size,
      sha: contents.sha,
      content: decodeGitHubContent(contents) || null,
    });
  });

  app.get("/api/canvas/github/repos/:owner/:repo/branches", async (c) => {
    const ghToken = requireGitHubToken();
    const branches = await githubFetch(
      `/repos/${c.req.param("owner")}/${c.req.param("repo")}/branches?per_page=30`,
      ghToken
    );
    return c.json({
      branches: branches.map((branch: Record<string, unknown>) => ({
        name: branch.name,
        sha: (branch.commit as Record<string, unknown>)?.sha,
      })),
    });
  });

  app.get("/api/canvas/github/repos/:owner/:repo/docs-files", async (c) => {
    const ghToken = requireGitHubToken();
    const subpath = c.req.query("path") || "";
    const dirPath = subpath ? `docs/${subpath}` : "docs";

    try {
      const contents = (await githubFetch(
        `/repos/${c.req.param("owner")}/${c.req.param("repo")}/contents/${dirPath}`,
        ghToken
      )) as GitHubContentItem;

      if (!Array.isArray(contents)) {
        return c.json({ items: [], path: subpath });
      }

      const items = contents
        .filter((item) => item.type === "dir" || (item.type === "file" && typeof item.name === "string" && item.name.endsWith(".md")))
        .map((item) => ({
          name: String(item.name),
          path: String(item.path),
          type: item.type as "file" | "dir",
          sha: item.sha,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "dir" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      return c.json({ items, path: subpath });
    } catch {
      return c.json({ items: [], path: subpath });
    }
  });

  app.post("/api/canvas/github/docs-import", async (c) => {
    const ghToken = requireGitHubToken();
    const body = await readJsonBody(c);
    const repoFullName = body.repoFullName as string;
    const filePath = body.filePath as string;
    const fileSha = body.fileSha as string;

    if (!repoFullName || !filePath) {
      return c.json({ error: "Missing repoFullName or filePath" }, 400);
    }

    const [owner, repo] = repoFullName.split("/");
    const fileData = (await githubFetch(
      `/repos/${owner}/${repo}/contents/${filePath}`,
      ghToken
    )) as GitHubContentFile;
    const markdownContent = decodeGitHubContent(fileData);

    const fileName = filePath.split("/").pop() || filePath;
    const title = fileName.replace(/\.md$/i, "").replace(/[-_]/g, " ");
    const docName = crypto.randomUUID();

    const ydoc = new Y.Doc();
    markdownToYjs(markdownContent, ydoc.getText("markdown"));
    const state = Y.encodeStateAsUpdate(ydoc);
    await upsertDoc(docName, Buffer.from(state));
    ydoc.destroy();

    await updateTitle(title, docName);
    await linkDocToFile(docName, repoFullName, filePath, fileSha || fileData.sha || null);

    return c.json({ docName, title }, 201);
  });

  app.get("/api/canvas/docs/:id/github-file", async (c) => {
    const link = await getDocFileLink(c.req.param("id"));
    if (!link) {
      return c.json({ linked: false });
    }
    return c.json({
      linked: true,
      repo_full_name: link.repo_full_name,
      file_path: link.file_path,
      file_sha: link.file_sha,
      last_synced_at: link.last_synced_at,
    });
  });

  app.post("/api/canvas/docs/:id/github-pull", async (c) => {
    const ghToken = requireGitHubToken();
    const docName = c.req.param("id");
    const link = await getDocFileLink(docName);
    if (!link) {
      return c.json({ error: "No file linked" }, 404);
    }

    const [owner, repo] = link.repo_full_name.split("/");
    const fileData = (await githubFetch(
      `/repos/${owner}/${repo}/contents/${link.file_path}`,
      ghToken
    )) as GitHubContentFile;
    const markdownContent = decodeGitHubContent(fileData);

    await withDirectConnection(hocuspocus, docName, (doc) => {
      markdownToYjs(markdownContent, doc.getText("markdown"));
    });

    if (fileData.sha) {
      await updateFileSha(docName, fileData.sha);
    }

    return c.json({ ok: true, sha: fileData.sha });
  });

  app.post("/api/canvas/docs/:id/github-push", async (c) => {
    const ghToken = requireGitHubToken();
    const docName = c.req.param("id");
    const link = await getDocFileLink(docName);
    if (!link) {
      return c.json({ error: "No file linked" }, 404);
    }

    const data = await getDoc(docName);
    if (!data) {
      return c.json({ error: "Document not found" }, 404);
    }

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(data));
    const ytext = ydoc.getText("markdown");
    const fragment = ydoc.getXmlFragment("default");
    const markdown = ytext.length > 0 ? ytext.toString() : fragment.length > 0 ? yjsToMarkdown(fragment) : "";
    ydoc.destroy();

    const [owner, repo] = link.repo_full_name.split("/");
    const repoInfo = await githubFetch(`/repos/${owner}/${repo}`, ghToken);
    const defaultBranch = repoInfo.default_branch || "main";
    const refData = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, ghToken);
    const baseSha = refData.object?.sha;

    if (!baseSha) {
      return c.json({ error: "Could not resolve default branch" }, 500);
    }

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

    let currentFileSha = link.file_sha;
    try {
      const fileInfo = (await githubFetch(
        `/repos/${owner}/${repo}/contents/${link.file_path}?ref=${branchName}`,
        ghToken
      )) as GitHubContentFile;
      currentFileSha = fileInfo.sha || currentFileSha;
    } catch {
      // Fall back to the last stored SHA.
    }

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

    const pr = await githubFetch(`/repos/${owner}/${repo}/pulls`, ghToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: commitMessage,
        body: `Updated via [Canvas](${process.env.CANVAS_PUBLIC_URL || "http://localhost:3000"})`,
        head: branchName,
        base: defaultBranch,
      }),
    });

    if (result.content?.sha) {
      await updateFileSha(docName, result.content.sha);
    }

    return c.json({
      ok: true,
      pr_number: pr.number,
      pr_url: pr.html_url,
      branch: branchName,
    });
  });

  app.delete("/api/canvas/docs/:id/github-file", async (c) => {
    await unlinkDocFile(c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
