import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import http from "node:http";
import * as Y from "yjs";
import {
  initDb,
  getDoc,
  upsertDoc,
  listDocs,
  getDocMeta,
  updateTitle,
  deleteDoc,
  addComment,
  getComments,
  deleteComments,
  getChatMessages,
  addChatMessage,
} from "./db.js";
import { yjsXmlFragmentToMarkdown } from "./markdown.js";

const PORT = parseInt(process.env.PORT || "1234", 10);

// Hocuspocus collab server with PostgreSQL persistence
const hocuspocus = new Server({
  port: PORT,
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

async function main() {
  await initDb();

  // REST API for agents/external access
  await hocuspocus.listen();
  console.log(`[canvas] Hocuspocus running on ws://localhost:${PORT}`);

  // Create a separate HTTP API server on PORT+1
  const apiPort = PORT + 1;
  const apiServer = http.createServer((req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${apiPort}`);
    const path = url.pathname;

    const readBody = (): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
      });

    const json = (data: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    (async () => {
      try {
        // GET /api/docs — list all documents
        if (path === "/api/docs" && req.method === "GET") {
          return json({ docs: await listDocs() });
        }

        // POST /api/docs — create a new document
        if (path === "/api/docs" && req.method === "POST") {
          const body = await readBody();
          const name = (body.name as string) || crypto.randomUUID();
          const title = (body.title as string) || "Untitled";
          await upsertDoc(name, null);
          await updateTitle(title, name);
          return json({ name, title }, 201);
        }

        // Document routes: /api/docs/:id
        const docMatch = path.match(/^\/api\/docs\/([^/]+)$/);
        if (docMatch) {
          const docName = docMatch[1];

          if (req.method === "GET") {
            const meta = await getDocMeta(docName);
            if (!meta) return json({ error: "Not found" }, 404);

            // Get document text content from Yjs
            const doc = hocuspocus.hocuspocus.documents.get(docName);
            let text = "";
            if (doc) {
              const ytext = doc.getText("markdown");
              text = ytext.toString();
            }

            return json({ ...meta, text });
          }

          if (req.method === "PUT") {
            const body = await readBody();
            if (body.title) {
              await updateTitle(body.title as string, docName);
            }
            if (body.content) {
              const connection = await hocuspocus.hocuspocus.openDirectConnection(docName);
              connection.transact((doc) => {
                const ytext = doc.getText("markdown");
                ytext.delete(0, ytext.length);
                ytext.insert(0, body.content as string);
              });
              await connection.disconnect();
            }
            return json({ ok: true });
          }

          if (req.method === "DELETE") {
            await deleteDoc(docName);
            await deleteComments(docName);
            return json({ ok: true });
          }
        }

        // Comments: /api/docs/:id/comments
        const commentMatch = path.match(/^\/api\/docs\/([^/]+)\/comments$/);
        if (commentMatch) {
          const docName = commentMatch[1];

          if (req.method === "GET") {
            return json({ comments: await getComments(docName) });
          }

          if (req.method === "POST") {
            const body = await readBody();
            const id = crypto.randomUUID();
            await addComment(
              id,
              docName,
              (body.userName as string) || "Anonymous",
              (body.text as string) || "",
              !!body.isAgent,
              (body.anchorQuote as string) || null,
              (body.anchorContext as string) || null,
              body.anchorFrom != null ? (body.anchorFrom as number) : null,
              body.anchorTo != null ? (body.anchorTo as number) : null,
              body.editActions ?? undefined
            );
            return json({ id }, 201);
          }
        }

        // Chat messages: /api/docs/:id/chat
        const chatMatch = path.match(/^\/api\/docs\/([^/]+)\/chat$/);
        if (chatMatch) {
          const docName = chatMatch[1];

          if (req.method === "GET") {
            return json({ messages: await getChatMessages(docName) });
          }

          if (req.method === "POST") {
            const body = await readBody();
            if (!body.id || !body.role || typeof body.content !== "string") {
              return json({ error: "Missing required fields: id, role, content" }, 400);
            }
            await addChatMessage(
              body.id as string,
              docName,
              body.role as string,
              body.content as string,
              body.editActions ?? undefined
            );
            return json({ ok: true }, 201);
          }
        }

        json({ error: "Not found" }, 404);
      } catch (err) {
        console.error("[api] error:", err);
        json({ error: "Internal server error" }, 500);
      }
    })();
  });

  apiServer.listen(apiPort, () => {
    console.log(`[canvas] REST API running on http://localhost:${apiPort}`);
  });
}

main().catch((err) => {
  console.error("[canvas] Failed to start:", err);
  process.exit(1);
});
