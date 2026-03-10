import http from "node:http";
import { parse } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { Database } from "@hocuspocus/extension-database";
import { Server as HocuspocusServer } from "@hocuspocus/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import next from "next";
import { WebSocketServer } from "ws";
import { getDoc, initDb, upsertDoc } from "./db.js";
import { createMcpServer } from "./mcp.js";
import { yjsXmlFragmentToMarkdown } from "./markdown.js";
import { createRoutes } from "./routes.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const dev = process.env.NODE_ENV !== "production";
const apiUrl = `http://localhost:${PORT}`;

const hocuspocus = new HocuspocusServer({
  extensions: [
    new Database({
      async fetch({ documentName }) {
        return (await getDoc(documentName)) ?? null;
      },
      async store({ documentName, state }) {
        await upsertDoc(documentName, Buffer.from(state));
      },
    }),
  ],
  async onLoadDocument({ document: doc }) {
    const ytext = doc.getText("markdown");
    if (ytext.length === 0) {
      const fragment = doc.getXmlFragment("default");
      if (fragment.length > 0) {
        const markdown = yjsXmlFragmentToMarkdown(fragment);
        if (markdown.trim()) {
          ytext.insert(0, markdown);
          console.log("[collab] migrated XmlFragment -> Y.Text for doc");
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

const apiApp = createRoutes(hocuspocus);
const handleApi = getRequestListener(apiApp.fetch);

function readRawBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Malformed JSON"));
      }
    });
  });
}

function writeMcpError(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url || "/", apiUrl);
  if (url.pathname !== "/mcp") {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, last-event-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    writeMcpError(res, 405, "Method not allowed.");
    return true;
  }

  (async () => {
    const body = await readRawBody(req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer({ apiUrl });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  })().catch((err) => {
    const message = err instanceof Error && err.message === "Malformed JSON" ? "Malformed JSON in request body" : "MCP error";
    console.error("[mcp]", err);
    if (!res.headersSent) {
      writeMcpError(res, message === "MCP error" ? 500 : 400, message);
    }
  });

  return true;
}

const app = next({ dev, dir: process.cwd() });
const handleNext = app.getRequestHandler();

async function main() {
  await initDb();
  await app.prepare();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", apiUrl);
    if (handleMcp(req, res)) {
      return;
    }
    if (url.pathname.startsWith("/api/canvas/")) {
      void handleApi(req, res);
      return;
    }
    const parsedUrl = parse(req.url || "/", true);
    void handleNext(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", apiUrl);
    if (!url.pathname.startsWith("/collab")) {
      socket.destroy();
      return;
    }
    const docName = url.pathname.slice("/collab/".length) || "default";
    wss.handleUpgrade(req, socket, head, (ws) => {
      hocuspocus.hocuspocus.handleConnection(ws, req, docName);
    });
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
