"use client";

import { useState, useEffect, useCallback } from "react";

interface ApiKeyInfo {
  key: string;
  key_prefix: string;
  label: string | null;
  created_at: string;
  last_used_at?: string | null;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/canvas/api-keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (err) {
      console.error("Failed to load API keys:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function createKey() {
    try {
      const res = await fetch("/api/canvas/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewKey(data.key);
        setLabel("");
        setShowCreate(false);
        fetchKeys();
      }
    } catch (err) {
      console.error("Failed to create API key:", err);
    }
  }

  async function revokeKey(fullKey: string) {
    try {
      const res = await fetch(`/api/canvas/api-keys/${fullKey}`, { method: "DELETE" });
      if (res.ok) fetchKeys();
    } catch (err) {
      console.error("Failed to revoke API key:", err);
    }
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const baseUrl = typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3000";

  const mcpConfig = `{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"],
      "env": {
        "CANVAS_API_KEY": "${newKey || keys[0]?.key || "your-api-key"}",
        "CANVAS_API_URL": "${baseUrl}"
      }
    }
  }
}`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1">API Keys</h1>
          <p className="text-sm text-[var(--muted)]">
            Keys for connecting Canvas to Claude Code, Codex, or other MCP clients.
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-85 transition-all cursor-pointer shrink-0"
          >
            + New key
          </button>
        )}
      </div>

      {/* Create key form */}
      {showCreate && (
        <div className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm outline-none focus:border-[var(--muted)] transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter") createKey();
              if (e.key === "Escape") { setShowCreate(false); setLabel(""); }
            }}
            autoFocus
          />
          <button onClick={createKey} className="px-4 py-2 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-85 transition-all cursor-pointer">
            Generate
          </button>
          <button onClick={() => { setShowCreate(false); setLabel(""); }} className="px-3 py-2 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer">
            Cancel
          </button>
        </div>
      )}

      {/* New key banner */}
      {newKey && (
        <div className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50">
          <p className="text-xs font-medium text-amber-800 mb-2">
            Copy this key now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white px-3 py-1.5 rounded border border-amber-200 font-mono break-all select-all">
              {newKey}
            </code>
            <button
              onClick={() => copyToClipboard(newKey, "newkey")}
              className="px-3 py-1.5 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer"
            >
              {copied === "newkey" ? "Copied" : "Copy"}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-1.5 text-xs text-amber-600 hover:underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <p className="text-sm text-[var(--muted)] py-4">Loading...</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-[var(--muted)] py-6">
          No keys yet. Generate one to connect Canvas to an MCP client.
        </p>
      ) : (
        <div className="mb-8">
          {/* Table header */}
          <div className="flex items-center py-2 border-b border-[var(--border)]">
            <span
              className="flex-1 text-[11px] font-semibold uppercase text-[var(--muted)]"
              style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
            >
              Name
            </span>
            <span
              className="w-32 text-[11px] font-semibold uppercase text-[var(--muted)]"
              style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
            >
              Key
            </span>
            <span
              className="w-20 text-right text-[11px] font-semibold uppercase text-[var(--muted)] mr-12"
              style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
            >
              Last used
            </span>
          </div>
          {keys.map((k) => (
            <div key={k.key} className="flex items-center py-3 border-b border-[var(--border)] last:border-b-0 group">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{k.label || "Untitled"}</span>
                <span className="text-xs text-[var(--muted)] ml-2">{formatDate(k.created_at)}</span>
              </div>
              <code className="w-32 text-xs text-[var(--muted)] font-mono">{k.key_prefix}</code>
              <span className="text-xs text-[var(--muted)] w-20 text-right">{timeAgo(k.last_used_at)}</span>
              <button
                onClick={() => revokeKey(k.key)}
                className="text-xs text-red-500 hover:text-red-600 transition-colors cursor-pointer ml-4 opacity-0 group-hover:opacity-100"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* MCP setup — Quick Start */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3
            className="text-[11px] font-semibold uppercase text-[var(--muted)]"
            style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
          >
            Quick Start
          </h3>
          <button
            onClick={() => copyToClipboard(mcpConfig, "mcp")}
            className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors cursor-pointer"
          >
            {copied === "mcp" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-[var(--muted)] mb-3">
          Paste into your Claude Code, Codex, or Claude Desktop config to connect Canvas as an MCP server.
        </p>
        <pre
          className="bg-[var(--fg)] text-[var(--bg)] rounded-lg p-4 text-xs font-mono leading-relaxed overflow-x-auto select-all"
        >{mcpConfig}</pre>
      </div>
    </div>
  );
}
