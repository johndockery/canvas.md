import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      data BYTEA,
      title TEXT DEFAULT 'Untitled',
      share_mode TEXT DEFAULT 'none',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Add share_mode column if table already exists without it
  await pool.query(`
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_mode TEXT DEFAULT 'none';
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      doc_name TEXT NOT NULL,
      user_name TEXT NOT NULL,
      text TEXT NOT NULL,
      is_agent BOOLEAN DEFAULT FALSE,
      anchor_quote TEXT,
      anchor_context TEXT,
      anchor_from INTEGER,
      anchor_to INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doc_github_links (
      doc_name TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      default_branch TEXT,
      linked_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (doc_name, repo_full_name)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doc_github_files (
      doc_name TEXT PRIMARY KEY,
      repo_full_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_sha TEXT,
      last_synced_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Add edit_actions column to comments if it doesn't exist
  await pool.query(`
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS edit_actions JSONB;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      doc_name TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      edit_actions JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("[db] PostgreSQL tables initialized");
}

// --- Document queries ---

export async function getDoc(name: string): Promise<Buffer | null> {
  const { rows } = await pool.query("SELECT data FROM documents WHERE name = $1", [name]);
  return rows[0]?.data ?? null;
}

export async function upsertDoc(name: string, data: Buffer | null) {
  await pool.query(
    `INSERT INTO documents (name, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [name, data]
  );
}

export async function listDocs() {
  const { rows } = await pool.query(
    "SELECT name, title, created_at, updated_at FROM documents ORDER BY updated_at DESC"
  );
  return rows;
}

export async function getDocMeta(name: string) {
  const { rows } = await pool.query(
    "SELECT name, title, created_at, updated_at FROM documents WHERE name = $1",
    [name]
  );
  return rows[0] ?? null;
}

export async function updateTitle(title: string, name: string) {
  await pool.query("UPDATE documents SET title = $1, updated_at = NOW() WHERE name = $2", [title, name]);
}

export async function deleteDoc(name: string) {
  await pool.query("DELETE FROM documents WHERE name = $1", [name]);
}

// --- Share mode queries ---

export async function getShareMode(name: string): Promise<string> {
  const { rows } = await pool.query("SELECT share_mode FROM documents WHERE name = $1", [name]);
  return rows[0]?.share_mode ?? "none";
}

export async function setShareMode(name: string, mode: string) {
  // Upsert: the doc may have been created by Hocuspocus but not via the REST API
  await pool.query(
    `INSERT INTO documents (name, share_mode, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (name) DO UPDATE SET share_mode = EXCLUDED.share_mode, updated_at = NOW()`,
    [name, mode]
  );
}

// --- Comment queries ---

export async function addComment(
  id: string,
  docName: string,
  userName: string,
  text: string,
  isAgent: boolean,
  anchorQuote: string | null,
  anchorContext: string | null,
  anchorFrom: number | null,
  anchorTo: number | null,
  editActions?: unknown
) {
  await pool.query(
    `INSERT INTO comments (id, doc_name, user_name, text, is_agent, anchor_quote, anchor_context, anchor_from, anchor_to, edit_actions, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [id, docName, userName, text, isAgent, anchorQuote, anchorContext, anchorFrom, anchorTo, editActions ? JSON.stringify(editActions) : null]
  );
}

export async function getComments(docName: string) {
  const { rows } = await pool.query(
    "SELECT id, user_name, text, is_agent, anchor_quote, anchor_context, anchor_from, anchor_to, edit_actions, created_at FROM comments WHERE doc_name = $1 ORDER BY created_at ASC",
    [docName]
  );
  return rows;
}

export async function deleteComments(docName: string) {
  await pool.query("DELETE FROM comments WHERE doc_name = $1", [docName]);
}

// --- Chat message queries ---

export async function getChatMessages(docName: string) {
  const { rows } = await pool.query(
    "SELECT id, role, content, edit_actions, created_at FROM chat_messages WHERE doc_name = $1 ORDER BY created_at ASC",
    [docName]
  );
  return rows;
}

export async function addChatMessage(
  id: string,
  docName: string,
  role: string,
  content: string,
  editActions?: unknown
) {
  await pool.query(
    `INSERT INTO chat_messages (id, doc_name, role, content, edit_actions, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [id, docName, role, content, editActions ? JSON.stringify(editActions) : null]
  );
}

export async function deleteChatMessages(docName: string) {
  await pool.query("DELETE FROM chat_messages WHERE doc_name = $1", [docName]);
}

// --- Doc-GitHub link queries ---

export async function getDocGitHubLinks(docName: string) {
  const { rows } = await pool.query(
    "SELECT doc_name, repo_full_name, default_branch, linked_at FROM doc_github_links WHERE doc_name = $1 ORDER BY linked_at DESC",
    [docName]
  );
  return rows;
}

export async function linkDocToRepo(docName: string, repoFullName: string, defaultBranch: string | null) {
  await pool.query(
    `INSERT INTO doc_github_links (doc_name, repo_full_name, default_branch, linked_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (doc_name, repo_full_name) DO UPDATE SET default_branch = EXCLUDED.default_branch, linked_at = NOW()`,
    [docName, repoFullName, defaultBranch]
  );
}

export async function unlinkDocFromRepo(docName: string, repoFullName: string) {
  await pool.query(
    "DELETE FROM doc_github_links WHERE doc_name = $1 AND repo_full_name = $2",
    [docName, repoFullName]
  );
}

export async function deleteDocGitHubLinks(docName: string) {
  await pool.query("DELETE FROM doc_github_links WHERE doc_name = $1", [docName]);
}

// --- Doc-GitHub file link queries ---

export async function getDocFileLink(docName: string) {
  const { rows } = await pool.query(
    "SELECT doc_name, repo_full_name, file_path, file_sha, last_synced_at FROM doc_github_files WHERE doc_name = $1",
    [docName]
  );
  return rows[0] ?? null;
}

export async function linkDocToFile(
  docName: string,
  repoFullName: string,
  filePath: string,
  fileSha: string | null
) {
  await pool.query(
    `INSERT INTO doc_github_files (doc_name, repo_full_name, file_path, file_sha, last_synced_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (doc_name) DO UPDATE SET repo_full_name = EXCLUDED.repo_full_name, file_path = EXCLUDED.file_path, file_sha = EXCLUDED.file_sha, last_synced_at = NOW()`,
    [docName, repoFullName, filePath, fileSha]
  );
}

export async function unlinkDocFile(docName: string) {
  await pool.query("DELETE FROM doc_github_files WHERE doc_name = $1", [docName]);
}

export async function updateFileSha(docName: string, fileSha: string) {
  await pool.query(
    "UPDATE doc_github_files SET file_sha = $1, last_synced_at = NOW() WHERE doc_name = $2",
    [fileSha, docName]
  );
}

export { pool };
