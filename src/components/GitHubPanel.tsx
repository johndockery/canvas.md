"use client";

import { useState, useEffect, useCallback } from "react";

interface Repo {
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  default_branch: string;
  private: boolean;
  updated_at: string;
  html_url: string;
}

interface DocsItem {
  name: string;
  path: string;
  type: "file" | "dir";
  sha: string;
}

interface FileLink {
  linked: boolean;
  repo_full_name?: string;
  file_path?: string;
  file_sha?: string;
  last_synced_at?: string;
}

interface GitHubPanelProps {
  docId: string;
}

type View =
  | { type: "main" }
  | { type: "pick-repo" }
  | { type: "pick-file"; repo: Repo; path: string };

export default function GitHubPanel({ docId }: GitHubPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  // File link
  const [fileLink, setFileLink] = useState<FileLink>({ linked: false });

  // Repo picker
  const [allRepos, setAllRepos] = useState<Repo[]>([]);

  // File/dir picker
  const [docsItems, setDocsItems] = useState<DocsItem[]>([]);

  // Sync state
  const [syncing, setSyncing] = useState(false);

  const [view, setView] = useState<View>({ type: "main" });

  // Load file link info
  const loadFileLink = useCallback(async () => {
    try {
      const res = await fetch(`/api/canvas/docs/${docId}/github-file`);
      if (res.ok) {
        const data = await res.json();
        setFileLink(data);
      }
    } catch {
      /* ignore */
    }
  }, [docId]);

  useEffect(() => {
    loadFileLink().finally(() => setLoading(false));
  }, [loadFileLink]);

  async function loadAllRepos() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/canvas/github/repos");
      if (res.ok) {
        const data = await res.json();
        setAllRepos(data.repos || []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDocsDir(repo: Repo, subpath: string) {
    setLoading(true);
    setError(null);
    setDocsItems([]);
    try {
      const qs = subpath ? `?path=${encodeURIComponent(subpath)}` : "";
      const res = await fetch(`/api/canvas/github/repos/${repo.owner}/${repo.name}/docs-files${qs}`);
      if (res.ok) {
        const data = await res.json();
        setDocsItems(data.items || []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function importFile(repo: Repo, item: DocsItem) {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/canvas/github/docs-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoFullName: repo.full_name,
          filePath: item.path,
          fileSha: item.sha,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      window.location.href = `/doc/${data.docName}`;
    } catch (err) {
      setError((err as Error).message);
      setSyncing(false);
    }
  }

  async function pullFromGitHub() {
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/canvas/docs/${docId}/github-pull`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pull failed");
      setSuccess("Pulled latest from GitHub");
      await loadFileLink();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function pushToGitHub() {
    setSyncing(true);
    setError(null);
    setSuccess(null);
    setPrUrl(null);
    try {
      const res = await fetch(`/api/canvas/docs/${docId}/github-push`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Push failed");
      }
      setSuccess(`PR #${data.pr_number} created`);
      setPrUrl(data.pr_url);
      await loadFileLink();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function unlinkFile() {
    setError(null);
    try {
      await fetch(`/api/canvas/docs/${docId}/github-file`, { method: "DELETE" });
      setFileLink({ linked: false });
      setSuccess(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading && view.type === "main") {
    return (
      <div className="p-4 text-xs text-[var(--muted)] text-center">Loading...</div>
    );
  }

  // --- Repo picker ---
  if (view.type === "pick-repo") {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <button
            onClick={() => setView({ type: "main" })}
            className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
          <span className="text-xs font-medium">Select Repository</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <p className="text-xs text-[var(--muted)] text-center py-4">Loading repos...</p>
          ) : allRepos.length === 0 ? (
            <p className="text-xs text-[var(--muted)] text-center py-4">No repositories found</p>
          ) : (
            allRepos.map((repo) => (
              <button
                key={repo.full_name}
                onClick={() => {
                  setView({ type: "pick-file", repo, path: "" });
                  loadDocsDir(repo, "");
                }}
                className="w-full text-left p-3 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer"
              >
                <div className="text-sm font-medium">{repo.full_name}</div>
                {repo.description && (
                  <div className="text-xs text-[var(--muted)] mt-0.5 truncate">{repo.description}</div>
                )}
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  {repo.private ? "Private" : "Public"} &middot; {repo.default_branch}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // --- File/directory picker ---
  if (view.type === "pick-file") {
    const { repo, path: currentPath } = view;
    const displayPath = currentPath ? `docs/${currentPath}` : "docs";
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <button
            onClick={() => {
              if (currentPath) {
                // Go up one directory level
                const parts = currentPath.split("/");
                parts.pop();
                const parentPath = parts.join("/");
                setView({ type: "pick-file", repo, path: parentPath });
                loadDocsDir(repo, parentPath);
              } else {
                setView({ type: "pick-repo" });
              }
              setError(null);
            }}
            className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
          <span className="text-xs font-medium truncate ml-2">{repo.name}/{displayPath}</span>
        </div>
        {error && (
          <div className="px-4 py-2 text-xs text-red-500 bg-red-50 ">{error}</div>
        )}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <p className="text-xs text-[var(--muted)] text-center py-4">Loading...</p>
          ) : docsItems.length === 0 ? (
            <p className="text-xs text-[var(--muted)] text-center py-4">
              {currentPath ? "No .md files in this directory" : "No /docs directory or no .md files found"}
            </p>
          ) : (
            docsItems.map((item) => (
              <button
                key={item.path}
                onClick={() => {
                  if (item.type === "dir") {
                    // Navigate into subdirectory
                    const subpath = item.path.replace(/^docs\/?/, "");
                    setView({ type: "pick-file", repo, path: subpath });
                    loadDocsDir(repo, subpath);
                  } else {
                    importFile(repo, item);
                  }
                }}
                disabled={syncing && item.type === "file"}
                className="w-full text-left p-3 rounded-lg hover:bg-[var(--surface)] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                <span className="text-xs text-[var(--muted)]">
                  {item.type === "dir" ? "\uD83D\uDCC1" : "\uD83D\uDCC4"}
                </span>
                <span className="text-sm">{item.name}</span>
              </button>
            ))
          )}
        </div>
        {syncing && (
          <div className="px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--muted)] text-center">
            Importing...
          </div>
        )}
      </div>
    );
  }

  // --- Main view ---
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div>
          <h3 className="font-semibold text-sm">GitHub</h3>
          <p className="text-xs text-[var(--muted)]">
            Uses the server GitHub token configured in the environment.
          </p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-50 ">{error}</div>
      )}
      {success && (
        <div className="px-4 py-2 text-xs text-green-600 bg-green-50 ">
          {success}
          {prUrl && (
            <>
              {" — "}
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                View PR
              </a>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {fileLink.linked ? (
          /* File is linked */
          <div className="p-4 space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-[var(--muted)]">Linked file</p>
              <p className="text-sm font-medium">{fileLink.file_path}</p>
              <p className="text-xs text-[var(--muted)]">{fileLink.repo_full_name}</p>
              {fileLink.last_synced_at && (
                <p className="text-xs text-[var(--muted)]">
                  Last synced: {new Date(fileLink.last_synced_at).toLocaleString()}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <button
                onClick={pullFromGitHub}
                disabled={syncing}
                className="w-full px-3 py-2 rounded-xl border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface)] transition-colors cursor-pointer disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Pull from GitHub"}
              </button>
              <button
                onClick={pushToGitHub}
                disabled={syncing}
                className="w-full px-3 py-2 rounded-xl bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-85 transition-colors cursor-pointer disabled:opacity-50"
              >
                {syncing ? "Creating PR..." : "Create PR"}
              </button>
              <button
                onClick={unlinkFile}
                className="w-full px-3 py-2 rounded-xl text-sm text-[var(--muted)] hover:text-red-500 transition-colors cursor-pointer"
              >
                Unlink file
              </button>
            </div>
          </div>
        ) : (
          /* No file linked */
          <div className="p-4 space-y-4">
            <p className="text-xs text-[var(--muted)]">
              No file linked to this document.
            </p>
            <button
              onClick={() => {
                loadAllRepos();
                setView({ type: "pick-repo" });
              }}
              className="w-full px-3 py-2 rounded-xl border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface)] transition-colors cursor-pointer"
            >
              Browse /docs files
            </button>
            <p className="text-[10px] text-[var(--muted)] leading-relaxed">
              Set `GITHUB_TOKEN` on the server if repository browsing or sync requests fail.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
