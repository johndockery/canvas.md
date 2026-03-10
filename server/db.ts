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
    CREATE TABLE IF NOT EXISTS github_connections (
      user_email TEXT PRIMARY KEY,
      github_username TEXT NOT NULL,
      access_token TEXT NOT NULL,
      connected_at TIMESTAMPTZ DEFAULT NOW()
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
    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      label TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_credentials (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_email TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      label TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_email, provider)
    );
  `);
  // Add last_used_at column to api_keys if it doesn't exist
  await pool.query(`
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
  `);
  // Add edit_actions column to comments if it doesn't exist
  await pool.query(`
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS edit_actions JSONB;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      owner_email TEXT NOT NULL,
      member_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (owner_email, member_email)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      owner_email TEXT NOT NULL,
      invite_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(owner_email, invite_email)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_github_repos (
      user_email TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      default_branch TEXT,
      description TEXT,
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_email, repo_full_name)
    );
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

// --- GitHub connection queries ---

export async function getGitHubConnection(userEmail: string) {
  const { rows } = await pool.query(
    "SELECT user_email, github_username, access_token, connected_at FROM github_connections WHERE user_email = $1",
    [userEmail]
  );
  return rows[0] ?? null;
}

export async function upsertGitHubConnection(
  userEmail: string,
  githubUsername: string,
  accessToken: string
) {
  await pool.query(
    `INSERT INTO github_connections (user_email, github_username, access_token, connected_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_email) DO UPDATE SET github_username = EXCLUDED.github_username, access_token = EXCLUDED.access_token, connected_at = NOW()`,
    [userEmail, githubUsername, accessToken]
  );
}

export async function deleteGitHubConnection(userEmail: string) {
  await pool.query("DELETE FROM github_connections WHERE user_email = $1", [userEmail]);
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

// --- API key queries ---

export async function createApiKey(key: string, email: string, label: string | null) {
  await pool.query(
    "INSERT INTO api_keys (key, user_email, label, created_at) VALUES ($1, $2, $3, NOW())",
    [key, email, label]
  );
}

export async function listApiKeys(email: string) {
  const { rows } = await pool.query(
    "SELECT key, label, created_at, last_used_at FROM api_keys WHERE user_email = $1 ORDER BY created_at DESC",
    [email]
  );
  return rows.map((r) => ({
    key: r.key,
    key_prefix: r.key.slice(0, 8) + "...",
    label: r.label,
    created_at: r.created_at,
    last_used_at: r.last_used_at,
  }));
}

export async function updateApiKeyLastUsed(key: string) {
  await pool.query(
    "UPDATE api_keys SET last_used_at = NOW() WHERE key = $1",
    [key]
  );
}

export async function deleteApiKey(key: string, email: string) {
  const { rowCount } = await pool.query(
    "DELETE FROM api_keys WHERE key = $1 AND user_email = $2",
    [key, email]
  );
  return (rowCount ?? 0) > 0;
}

export async function getApiKeyEmail(key: string): Promise<string | null> {
  const { rows } = await pool.query(
    "SELECT user_email FROM api_keys WHERE key = $1",
    [key]
  );
  return rows[0]?.user_email ?? null;
}

// --- User credential queries ---

export async function upsertUserCredential(
  userEmail: string,
  provider: string,
  apiKey: string,
  label: string | null
) {
  await pool.query(
    `INSERT INTO user_credentials (user_email, provider, api_key, label, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (user_email, provider) DO UPDATE SET api_key = EXCLUDED.api_key, label = EXCLUDED.label, updated_at = NOW()`,
    [userEmail, provider, apiKey, label]
  );
}

export async function getUserCredentialKey(
  userEmail: string,
  provider: string
): Promise<string | null> {
  const { rows } = await pool.query(
    "SELECT api_key FROM user_credentials WHERE user_email = $1 AND provider = $2",
    [userEmail, provider]
  );
  return rows[0]?.api_key ?? null;
}

export async function listUserCredentials(userEmail: string) {
  const { rows } = await pool.query(
    "SELECT provider, label, created_at FROM user_credentials WHERE user_email = $1 ORDER BY created_at DESC",
    [userEmail]
  );
  return rows;
}

export async function deleteUserCredential(userEmail: string, provider: string) {
  const { rowCount } = await pool.query(
    "DELETE FROM user_credentials WHERE user_email = $1 AND provider = $2",
    [userEmail, provider]
  );
  return (rowCount ?? 0) > 0;
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

// --- Team member queries ---

export async function listTeamMembers(ownerEmail: string) {
  const { rows } = await pool.query(
    "SELECT member_email, role, joined_at FROM team_members WHERE owner_email = $1 ORDER BY joined_at ASC",
    [ownerEmail]
  );
  return rows;
}

export async function addTeamMember(ownerEmail: string, memberEmail: string, role: string) {
  await pool.query(
    `INSERT INTO team_members (owner_email, member_email, role, joined_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (owner_email, member_email) DO UPDATE SET role = EXCLUDED.role`,
    [ownerEmail, memberEmail, role]
  );
}

export async function removeTeamMember(ownerEmail: string, memberEmail: string) {
  const { rowCount } = await pool.query(
    "DELETE FROM team_members WHERE owner_email = $1 AND member_email = $2",
    [ownerEmail, memberEmail]
  );
  return (rowCount ?? 0) > 0;
}

export async function listTeamInvites(ownerEmail: string) {
  const { rows } = await pool.query(
    "SELECT id, invite_email, role, created_at FROM team_invites WHERE owner_email = $1 ORDER BY created_at DESC",
    [ownerEmail]
  );
  return rows;
}

export async function createTeamInvite(ownerEmail: string, inviteEmail: string, role: string) {
  const { rows } = await pool.query(
    `INSERT INTO team_invites (owner_email, invite_email, role, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (owner_email, invite_email) DO UPDATE SET role = EXCLUDED.role, created_at = NOW()
     RETURNING id, invite_email, role, created_at`,
    [ownerEmail, inviteEmail, role]
  );
  return rows[0];
}

export async function deleteTeamInvite(ownerEmail: string, inviteId: string) {
  const { rowCount } = await pool.query(
    "DELETE FROM team_invites WHERE owner_email = $1 AND id = $2",
    [ownerEmail, inviteId]
  );
  return (rowCount ?? 0) > 0;
}

export async function acceptTeamInvite(inviteEmail: string) {
  // Find all invites for this email, add as member, delete the invites
  const { rows } = await pool.query(
    "SELECT owner_email, invite_email, role FROM team_invites WHERE invite_email = $1",
    [inviteEmail]
  );
  for (const row of rows) {
    await addTeamMember(row.owner_email, row.invite_email, row.role);
  }
  await pool.query("DELETE FROM team_invites WHERE invite_email = $1", [inviteEmail]);
  return rows.length;
}

// --- User GitHub repos (for AI agent context) ---

export async function getUserGitHubRepos(userEmail: string) {
  const { rows } = await pool.query(
    "SELECT repo_full_name, default_branch, description, connected_at FROM user_github_repos WHERE user_email = $1 ORDER BY connected_at DESC",
    [userEmail]
  );
  return rows;
}

export async function addUserGitHubRepo(
  userEmail: string,
  repoFullName: string,
  defaultBranch: string | null,
  description: string | null
) {
  await pool.query(
    `INSERT INTO user_github_repos (user_email, repo_full_name, default_branch, description, connected_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_email, repo_full_name) DO UPDATE SET default_branch = EXCLUDED.default_branch, description = EXCLUDED.description, connected_at = NOW()`,
    [userEmail, repoFullName, defaultBranch, description]
  );
}

export async function removeUserGitHubRepo(userEmail: string, repoFullName: string) {
  const { rowCount } = await pool.query(
    "DELETE FROM user_github_repos WHERE user_email = $1 AND repo_full_name = $2",
    [userEmail, repoFullName]
  );
  return (rowCount ?? 0) > 0;
}

export { pool };
