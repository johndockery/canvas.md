import { serve } from "@hono/node-server";
import { Database } from "@hocuspocus/extension-database";
import { Server as HocuspocusServer } from "@hocuspocus/server";
import { getDoc, initDb, upsertDoc } from "./db.js";
import { yjsXmlFragmentToMarkdown } from "./markdown.js";
import { createRoutes } from "./routes.js";

const PORT = parseInt(process.env.PORT || "1234", 10);

const hocuspocus = new HocuspocusServer({
  port: PORT,
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

async function main() {
  await initDb();
  await hocuspocus.listen();
  console.log(`[canvas] Hocuspocus running on ws://localhost:${PORT}`);

  serve(
    {
      fetch: createRoutes(hocuspocus).fetch,
      port: PORT + 1,
    },
    () => {
      console.log(`[canvas] REST API running on http://localhost:${PORT + 1}`);
    }
  );
}

main().catch((err) => {
  console.error("[canvas] Failed to start:", err);
  process.exit(1);
});
