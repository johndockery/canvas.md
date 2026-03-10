CREATE TABLE IF NOT EXISTS documents (
  name TEXT PRIMARY KEY,
  data BYTEA,
  title TEXT DEFAULT 'Untitled',
  share_mode TEXT DEFAULT 'none',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
  edit_actions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doc_github_links (
  doc_name TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  default_branch TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (doc_name, repo_full_name)
);

CREATE TABLE IF NOT EXISTS doc_github_files (
  doc_name TEXT PRIMARY KEY,
  repo_full_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  doc_name TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  edit_actions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_doc_name ON comments (doc_name);
CREATE INDEX IF NOT EXISTS idx_chat_messages_doc_name ON chat_messages (doc_name);
CREATE INDEX IF NOT EXISTS idx_doc_github_files_repo ON doc_github_files (repo_full_name);
