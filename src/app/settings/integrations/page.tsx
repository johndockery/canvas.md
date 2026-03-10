"use client";

import { useState, useEffect, useCallback } from "react";

// ============================================================
// Types
// ============================================================

interface GitHubStatus {
  connected: boolean;
  github_username: string | null;
}

interface ProviderConfig {
  id: string;
  label: string;
  subtitle: string;
  handle: string;
}

const providers: ProviderConfig[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    subtitle: "Claude Sonnet, Claude Opus",
    handle: "@claude",
  },
  {
    id: "openai",
    label: "OpenAI",
    subtitle: "GPT-4o, o1, o3",
    handle: "@chatgpt",
  },
];

// ============================================================
// Main page
// ============================================================

export default function IntegrationsPage() {
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [github, setGitHub] = useState<GitHubStatus>({
    connected: false,
    github_username: null,
  });
  const [loadingGitHub, setLoadingGitHub] = useState(true);

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch("/api/canvas/credentials");
      if (res.ok) {
        const data = await res.json();
        // Expect data like { anthropic: true, openai: false } or similar
        const map: Record<string, boolean> = {};
        if (data.credentials) {
          for (const cred of data.credentials) {
            map[cred.provider] = true;
          }
        } else {
          // Fallback: treat top-level keys as providers
          for (const key of Object.keys(data)) {
            if (typeof data[key] === "boolean") {
              map[key] = data[key];
            }
          }
        }
        setCredentials(map);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingCredentials(false);
    }
  }, []);

  const fetchGitHub = useCallback(async () => {
    try {
      const res = await fetch("/api/canvas/github/status");
      if (res.ok) {
        const data = await res.json();
        setGitHub({
          connected: !!data.connected,
          github_username: data.github_username || null,
        });
      }
    } catch {
      // silently fail
    } finally {
      setLoadingGitHub(false);
    }
  }, []);

  useEffect(() => {
    fetchCredentials();
    fetchGitHub();
  }, [fetchCredentials, fetchGitHub]);

  async function disconnectGitHub() {
    try {
      await fetch("/api/canvas/github/disconnect", { method: "DELETE" });
      setGitHub({ connected: false, github_username: null });
    } catch (err) {
      console.error("Failed to disconnect GitHub:", err);
    }
  }

  function connectGitHub() {
    window.location.href = "/api/canvas/github/auth";
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Integrations</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Connect AI providers and external services.
      </p>

      {/* AI Providers section */}
      <section className="mb-10">
        <h2
          className="text-[11px] font-semibold text-[var(--muted)] uppercase mb-3"
          style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
        >
          AI Providers
        </h2>

        {/* Table header */}
        <div className="flex items-center px-5 py-2 border-b border-[var(--border)]">
          <span
            className="flex-1 text-[11px] font-semibold uppercase text-[var(--muted)]"
            style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
          >
            Provider
          </span>
          <span
            className="w-24 text-[11px] font-semibold uppercase text-[var(--muted)]"
            style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
          >
            Handle
          </span>
          <span
            className="w-32 text-right text-[11px] font-semibold uppercase text-[var(--muted)]"
            style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
          >
            Status
          </span>
        </div>

        <div className="border border-[var(--border)] border-t-0 rounded-b-xl overflow-hidden divide-y divide-[var(--border)]">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              connected={credentials[provider.id] || false}
              loading={loadingCredentials}
              onUpdate={fetchCredentials}
            />
          ))}
        </div>
      </section>

      {/* Services section */}
      <section className="mb-10">
        <h2
          className="text-[11px] font-semibold text-[var(--muted)] uppercase mb-3"
          style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
        >
          Services
        </h2>
        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium">GitHub</p>
                <p className="text-xs text-[var(--muted)]">
                  Link repos, browse code, create PRs
                </p>
              </div>
            </div>

            {loadingGitHub ? (
              <span className="text-xs text-[var(--muted)]">...</span>
            ) : github.connected ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span className="text-sm text-[var(--muted)]">
                    {github.github_username}
                  </span>
                </div>
                <button
                  onClick={disconnectGitHub}
                  className="text-xs text-[var(--muted)] hover:text-red-500 transition-colors cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={connectGitHub}
                className="px-3.5 py-1.5 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </section>

      {/* AI Repository Context section — only visible when GitHub is connected */}
      {github.connected && (
        <section>
          <h2
            className="text-[11px] font-semibold text-[var(--muted)] uppercase mb-3"
            style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
          >
            AI Repository Context
          </h2>
          <p className="text-xs text-[var(--muted)] mb-3">
            Connected repos are available to @claude when answering questions and making edits.
          </p>
          <RepoSelector />
        </section>
      )}
    </div>
  );
}

// ============================================================
// Repo selector for AI context
// ============================================================

interface ConnectedRepo {
  repo_full_name: string;
  default_branch: string | null;
  description: string | null;
}

interface AvailableRepo {
  full_name: string;
  description: string | null;
  default_branch: string;
}

function RepoSelector() {
  const [connectedRepos, setConnectedRepos] = useState<ConnectedRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [availableRepos, setAvailableRepos] = useState<AvailableRepo[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  const fetchConnected = useCallback(async () => {
    try {
      const res = await fetch("/api/canvas/github/user-repos");
      if (res.ok) {
        const data = await res.json();
        setConnectedRepos(data.repos || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnected();
  }, [fetchConnected]);

  async function openPicker() {
    setShowPicker(true);
    setLoadingAvailable(true);
    try {
      const res = await fetch("/api/canvas/github/repos");
      if (res.ok) {
        const data = await res.json();
        setAvailableRepos(data.repos || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingAvailable(false);
    }
  }

  async function addRepo(repo: AvailableRepo) {
    try {
      const res = await fetch("/api/canvas/github/user-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoFullName: repo.full_name,
          defaultBranch: repo.default_branch,
          description: repo.description,
        }),
      });
      if (res.ok) {
        setShowPicker(false);
        fetchConnected();
      }
    } catch (err) {
      console.error("Failed to add repo:", err);
    }
  }

  async function removeRepo(repoFullName: string) {
    try {
      const res = await fetch(
        `/api/canvas/github/user-repos/${repoFullName}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setConnectedRepos((prev) =>
          prev.filter((r) => r.repo_full_name !== repoFullName)
        );
      }
    } catch (err) {
      console.error("Failed to remove repo:", err);
    }
  }

  if (loading) {
    return (
      <div className="border border-[var(--border)] rounded-xl px-5 py-4">
        <span className="text-xs text-[var(--muted)]">Loading...</span>
      </div>
    );
  }

  const connectedNames = new Set(connectedRepos.map((r) => r.repo_full_name));
  const unconnectedRepos = availableRepos.filter(
    (r) => !connectedNames.has(r.full_name)
  );

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      {connectedRepos.length === 0 && !showPicker ? (
        <div className="px-5 py-4 flex items-center justify-between">
          <span className="text-sm text-[var(--muted)]">
            No repos connected yet
          </span>
          <button
            onClick={openPicker}
            className="px-3.5 py-1.5 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Add Repository
          </button>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[var(--border)]">
            {connectedRepos.map((repo) => (
              <div
                key={repo.repo_full_name}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {repo.repo_full_name}
                  </p>
                  {repo.description && (
                    <p className="text-xs text-[var(--muted)] truncate">
                      {repo.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removeRepo(repo.repo_full_name)}
                  className="text-xs text-[var(--muted)] hover:text-red-500 transition-colors cursor-pointer shrink-0 ml-3"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {showPicker ? (
            <div className="border-t border-[var(--border)] px-5 py-3">
              {loadingAvailable ? (
                <span className="text-xs text-[var(--muted)]">
                  Loading repos...
                </span>
              ) : unconnectedRepos.length === 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--muted)]">
                    No more repos available
                  </span>
                  <button
                    onClick={() => setShowPicker(false)}
                    className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[var(--muted)]">
                      Select a repository
                    </span>
                    <button
                      onClick={() => setShowPicker(false)}
                      className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto -mx-1">
                    {unconnectedRepos.map((repo) => (
                      <button
                        key={repo.full_name}
                        onClick={() => addRepo(repo)}
                        className="w-full text-left px-2 py-2 rounded-lg hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                      >
                        <p className="text-sm font-medium truncate">
                          {repo.full_name}
                        </p>
                        {repo.description && (
                          <p className="text-xs text-[var(--muted)] truncate">
                            {repo.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="border-t border-[var(--border)] px-5 py-3">
              <button
                onClick={openPicker}
                className="text-sm text-[var(--accent)] hover:underline cursor-pointer"
              >
                + Add Repository
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Provider row
// ============================================================

function ProviderRow({
  provider,
  connected,
  loading,
  onUpdate,
}: {
  provider: ProviderConfig;
  connected: boolean;
  loading: boolean;
  onUpdate: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  async function saveKey() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/canvas/credentials/${provider.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (res.ok) {
        setApiKey("");
        setShowForm(false);
        onUpdate();
      }
    } catch (err) {
      console.error(`Failed to save ${provider.label} key:`, err);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    try {
      const res = await fetch(`/api/canvas/credentials/${provider.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setShowMenu(false);
        onUpdate();
      }
    } catch (err) {
      console.error(`Failed to disconnect ${provider.label}:`, err);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div>
            <p className="text-sm font-medium">{provider.label}</p>
            <p className="text-xs text-[var(--muted)]">{provider.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-[var(--muted)] font-mono">
            {provider.handle}
          </span>

          {loading ? (
            <span className="text-xs text-[var(--muted)]">...</span>
          ) : connected ? (
            <div className="flex items-center gap-2 relative">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-xs text-green-600">Connected</span>
              </div>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] transition-colors cursor-pointer text-[var(--muted)]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {showMenu && (
                <div
                  className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-[var(--border)] bg-[var(--bg)] py-1 z-10"
                  style={{ boxShadow: "var(--shadow-lg)" }}
                >
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowForm(true);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                  >
                    Update key
                  </button>
                  <button
                    onClick={disconnect}
                    className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="px-3.5 py-1.5 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`Paste your ${provider.label} API key`}
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm outline-none focus:border-[var(--accent)] transition-colors font-mono"
            onKeyDown={(e) => {
              if (e.key === "Enter") saveKey();
              if (e.key === "Escape") {
                setShowForm(false);
                setApiKey("");
              }
            }}
            autoFocus
          />
          <button
            onClick={saveKey}
            disabled={saving || !apiKey.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-85 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={() => {
              setShowForm(false);
              setApiKey("");
            }}
            className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
