"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Doc {
  name: string;
  title: string;
  created_at: string;
  updated_at: string;
  repo_full_name?: string;
  contributors?: { name: string; image?: string }[];
  has_agent_comments?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

const AVATAR_COLORS = [
  "#8b7355",
  "#6b8e6b",
  "#c4703f",
  "#a0856e",
  "#7c8b6f",
  "#b5845a",
  "#6f8a8f",
  "#9b7c5c",
  "#7a8b72",
  "#c28b5e",
];

function avatarColor(name: string): string {
  const idx = Math.abs(hashCode(name)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

function AvatarCircle({
  person,
  size = 24,
  offset = false,
}: {
  person: { name: string; image?: string };
  size?: number;
  offset?: boolean;
}) {
  const s = `${size}px`;
  const fontSize = size <= 24 ? "9px" : "10px";
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 ring-2 ring-[var(--bg)]"
      style={{
        width: s,
        height: s,
        marginLeft: offset ? "-6px" : "0",
        backgroundColor: person.image ? undefined : avatarColor(person.name),
        overflow: "hidden",
      }}
    >
      {person.image ? (
        <img
          src={person.image}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-white font-semibold" style={{ fontSize }}>
          {initials(person.name)}
        </span>
      )}
    </div>
  );
}

function AvatarStack({
  people,
  size = 24,
}: {
  people: { name: string; image?: string }[];
  size?: number;
}) {
  if (!people || people.length === 0) return null;
  return (
    <div className="flex items-center">
      {people.slice(0, 4).map((p, i) => (
        <AvatarCircle key={p.name + i} person={p} size={size} offset={i > 0} />
      ))}
      {people.length > 4 && (
        <span
          className="text-[var(--muted)] ml-1"
          style={{ fontSize: "10px" }}
        >
          +{people.length - 4}
        </span>
      )}
    </div>
  );
}

function GitHubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function AIBadge() {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
      style={{
        backgroundColor: "var(--accent-light)",
        color: "var(--accent)",
      }}
    >
      AI
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Home() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/canvas/docs");
      if (res.ok) {
        const data = await res.json();
        setDocs(data.docs || []);
      }
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // ---- Helpers for doc creation / deletion ----

  async function createDoc() {
    try {
      const res = await fetch("/api/canvas/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/doc/${data.name}`);
      }
    } catch (err) {
      console.error("Failed to create document:", err);
    }
  }

  async function deleteDoc(name: string) {
    try {
      const res = await fetch(`/api/canvas/docs/${name}`, { method: "DELETE" });
      if (res.ok) {
        setDocs((prev) => prev.filter((d) => d.name !== name));
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }

  // ---- Derived data ----

  const sortedByRecent = [...docs].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  const jumpBackInDocs = sortedByRecent.slice(0, 3);

  // Check if any doc has repo info
  const hasRepoInfo = docs.some((d) => d.repo_full_name);

  // Group by repo
  const repoGroups: Record<string, Doc[]> = {};
  const ungrouped: Doc[] = [];
  if (hasRepoInfo) {
    for (const doc of sortedByRecent) {
      if (doc.repo_full_name) {
        if (!repoGroups[doc.repo_full_name]) {
          repoGroups[doc.repo_full_name] = [];
        }
        repoGroups[doc.repo_full_name].push(doc);
      } else {
        ungrouped.push(doc);
      }
    }
  }

  // Unique contributors per group
  function groupContributors(
    groupDocs: Doc[]
  ): { name: string; image?: string }[] {
    const seen = new Set<string>();
    const result: { name: string; image?: string }[] = [];
    for (const doc of groupDocs) {
      for (const c of doc.contributors || []) {
        if (!seen.has(c.name)) {
          seen.add(c.name);
          result.push(c);
        }
      }
    }
    return result;
  }

  function repoShortName(fullName: string): string {
    const parts = fullName.split("/");
    return parts.length > 1 ? parts[1] : fullName;
  }

  // ---- Helpers for greeting ----

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  const firstName = "there";

  const todayCount = docs.filter((d) => {
    const updated = new Date(d.updated_at);
    const now = new Date();
    return (
      updated.getFullYear() === now.getFullYear() &&
      updated.getMonth() === now.getMonth() &&
      updated.getDate() === now.getDate()
    );
  }).length;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] px-4 md:px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">canvas.md</span>
      </header>

      <main className="max-w-[700px] mx-auto px-4 md:px-6 py-8">
        {loadingDocs ? (
          <div className="text-center py-20">
            <span className="text-[var(--muted)]">Loading documents...</span>
          </div>
        ) : docs.length === 0 ? (
          /* ---- Empty state ---- */
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mx-auto mb-5">
              <svg
                width="24"
                height="24"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-[var(--muted)] mb-1 font-medium">
              No documents yet
            </p>
            <p className="text-[var(--muted)] text-sm mb-6">
              Create your first document to get started.
            </p>
            <button
              onClick={createDoc}
              className="px-6 py-3 rounded-xl bg-[var(--fg)] text-[var(--bg)] font-medium hover:opacity-85 transition-colors cursor-pointer"
              style={{ boxShadow: "var(--shadow-md)" }}
            >
              Create your first document
            </button>
          </div>
        ) : (
          /* ---- Documents layout ---- */
          <div className="space-y-10">
            {/* -- Greeting -- */}
            <section className="flex items-end justify-between">
              <div>
                <h1
                  className="text-[28px] font-semibold tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {getGreeting()}, {firstName}
                </h1>
                <p className="text-sm text-[var(--muted)] mt-1">
                  {todayCount > 0
                    ? `${todayCount} document${todayCount !== 1 ? "s" : ""} updated today`
                    : "No documents updated today"}
                </p>
              </div>
              <button
                onClick={createDoc}
                className="px-4 py-2 rounded-full bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer shrink-0"
              >
                New document
              </button>
            </section>

            {/* -- Jump Back In -- */}
            <section>
              <h2
                className="text-[11px] font-semibold uppercase text-[var(--muted)] mb-3"
                style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
              >
                Jump back in
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {jumpBackInDocs.map((doc) => (
                  <div
                    key={doc.name}
                    onClick={() => router.push(`/doc/${doc.name}`)}
                    className="shrink-0 w-[220px] rounded-xl border border-[var(--border)] p-4 cursor-pointer hover:border-[var(--muted)] hover:shadow-sm transition-all group"
                    style={{ boxShadow: "var(--shadow-sm)" }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-4">
                      <h3 className="font-semibold text-sm leading-snug line-clamp-2">
                        {doc.title || "Untitled"}
                      </h3>
                      <span className="text-[11px] text-[var(--muted)] shrink-0 pt-0.5">
                        {timeAgo(doc.updated_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      {doc.repo_full_name ? (
                        <span className="text-[11px] text-[var(--muted)] truncate max-w-[120px]">
                          {repoShortName(doc.repo_full_name)}
                        </span>
                      ) : (
                        <span />
                      )}
                      {doc.contributors && doc.contributors.length > 0 && (
                        <AvatarStack people={doc.contributors} size={22} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* -- Repo-grouped docs or flat list -- */}
            {hasRepoInfo ? (
              <>
                {Object.entries(repoGroups).map(
                  ([repoName, groupDocs]) => {
                    const contributors = groupContributors(groupDocs);
                    return (
                      <section key={repoName}>
                        {/* Repo header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <GitHubIcon size={15} />
                            <span className="font-semibold text-sm">
                              {repoShortName(repoName)}
                            </span>
                            <span className="text-xs text-[var(--muted)]">
                              {groupDocs.length} doc
                              {groupDocs.length !== 1 ? "s" : ""}
                              {contributors.length > 0 &&
                                ` \u00B7 ${contributors.length} contributor${contributors.length !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                          <button
                            onClick={createDoc}
                            className="text-xs text-[var(--muted)] border border-[var(--border)] rounded-full px-3 py-1 hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                          >
                            Add doc
                          </button>
                        </div>

                        {/* Doc rows */}
                        <div className="border-l-2 border-[var(--border)] ml-[7px] pl-5 space-y-0.5">
                          {groupDocs.map((doc) => (
                            <DocRow
                              key={doc.name}
                              doc={doc}
                              onNavigate={() =>
                                router.push(`/doc/${doc.name}`)
                              }
                              onDelete={() => deleteDoc(doc.name)}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  }
                )}

                {/* Ungrouped docs */}
                {ungrouped.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-sm">
                        Other documents
                      </span>
                      <button
                        onClick={createDoc}
                        className="text-xs text-[var(--muted)] border border-[var(--border)] rounded-full px-3 py-1 hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                      >
                        Add doc
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {ungrouped.map((doc) => (
                        <DocRow
                          key={doc.name}
                          doc={doc}
                          onNavigate={() =>
                            router.push(`/doc/${doc.name}`)
                          }
                          onDelete={() => deleteDoc(doc.name)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              /* Flat list fallback when no repo info available */
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">All documents</span>
                </div>
                <div className="space-y-0.5">
                  {sortedByRecent.map((doc) => (
                    <DocRow
                      key={doc.name}
                      doc={doc}
                      onNavigate={() => router.push(`/doc/${doc.name}`)}
                      onDelete={() => deleteDoc(doc.name)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocRow component
// ---------------------------------------------------------------------------

function DocRow({
  doc,
  onNavigate,
  onDelete,
}: {
  doc: Doc;
  onNavigate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onNavigate}
      className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg hover:bg-[var(--surface-hover)] transition-colors cursor-pointer group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">
          {doc.title || "Untitled"}
        </span>
        {doc.has_agent_comments && <AIBadge />}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {doc.contributors && doc.contributors.length > 0 && (
          <AvatarStack people={doc.contributors} size={22} />
        )}
        <span className="text-[11px] text-[var(--muted)] w-8 text-right">
          {timeAgo(doc.updated_at)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-[11px] text-[var(--muted)] hover:text-red-500 transition-colors cursor-pointer opacity-0 group-hover:opacity-100 w-9 text-right"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
