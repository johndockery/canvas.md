"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import AuthButton from "@/components/AuthButton";
import type { AnchorData, ApplyTextReplacement } from "@/components/Editor";

const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });
const SidebarTabs = dynamic(() => import("@/components/SidebarTabs"), {
  ssr: false,
});
const GitHubPanel = dynamic(() => import("@/components/GitHubPanel"), {
  ssr: false,
});

type SidePanel = "comments" | "github" | null;
type ShareMode = "none" | "view" | "edit";

export default function DocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const [sidePanel, setSidePanel] = useState<SidePanel>(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) return "comments";
    return null;
  });
  const [pendingAnchor, setPendingAnchor] = useState<AnchorData | null>(null);
  const [shareMode, setShareMode] = useState<ShareMode | null>(null);
  const [shareLoading, setShareLoading] = useState(true);
  const [title, setTitle] = useState("Untitled");

  // Editor ref for agent-edit integration
  const editorHelpersRef = useRef<{ getText: () => string } | null>(null);
  const [applyTextReplacement, setApplyTextReplacement] = useState<ApplyTextReplacement | null>(null);

  const handleEditorReady = useCallback((helpers: { getText: () => string }) => {
    editorHelpersRef.current = helpers;
  }, []);

  const handleReplacementReady = useCallback((fn: ApplyTextReplacement) => {
    // Wrap in a function because setState interprets a bare function as a lazy initializer
    setApplyTextReplacement(() => fn);
  }, []);

  const getDocumentText = useCallback(() => {
    if (!editorHelpersRef.current) return "";
    return editorHelpersRef.current.getText() || "";
  }, []);

  const handleUndoEdit = useCallback(() => {
    // Undo is handled within CommentsSidebar via applyTextReplacement.
    // This callback is available for any additional coordination needed.
  }, []);

  // Fetch share mode + doc meta on load
  useEffect(() => {
    fetch(`/api/canvas/docs/${id}/sharing`)
      .then((r) => r.json())
      .then((data) => setShareMode(data.mode || "none"))
      .catch(() => setShareMode("none"))
      .finally(() => setShareLoading(false));

    fetch(`/api/canvas/docs/${id}`)
      .then((r) => r.json())
      .then((data) => { if (data.title) setTitle(data.title); })
      .catch(() => {});
  }, [id]);

  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  const saveTitle = useCallback(
    (newTitle: string) => {
      const trimmed = newTitle.trim() || "Untitled";
      setTitle(trimmed);
      setSaveStatus("saving");
      fetch(`/api/canvas/docs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      })
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("saved"));
    },
    [id]
  );

  const handleSelectionComment = useCallback((anchor: AnchorData) => {
    setPendingAnchor(anchor);
    setSidePanel("comments");
  }, []);

  const handleAnchorConsumed = useCallback(() => {
    setPendingAnchor(null);
  }, []);

  function togglePanel(panel: "comments" | "github") {
    setSidePanel((prev) => (prev === panel ? null : panel));
  }

  if (status === "loading" || shareLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-[var(--muted)]">Loading...</span>
      </div>
    );
  }

  const isAnonymous = !session;
  const canView = !isAnonymous || shareMode === "view" || shareMode === "edit";
  const canEdit = !isAnonymous || shareMode === "edit";
  const readOnly = !canEdit;

  // Not signed in and doc is private → sign-in prompt
  if (!canView) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-sm w-full p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">canvas</h1>
          <p className="text-[var(--muted)] mb-8 text-sm">
            Sign in to view and edit this document
          </p>
          <button
            onClick={() => signIn("google")}
            className="w-full px-4 py-3 rounded-xl bg-[var(--fg)] text-[var(--bg)] font-medium hover:opacity-85 transition-colors cursor-pointer"
            style={{ boxShadow: "var(--shadow-md)" }}
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const userName = session?.user?.name || "Anonymous";

  const showSidebar = sidePanel && (!isAnonymous || (isAnonymous && canEdit && sidePanel === "comments"));

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-[var(--border)] px-4 py-3 flex items-center justify-between shrink-0 gap-2 relative z-[60]">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Link
            href="/"
            className="text-[var(--muted)] hover:text-[var(--fg)] transition-colors shrink-0"
          >
            <span className="text-sm font-bold">canvas</span>
          </Link>
          <span className="text-[var(--border)]">/</span>
          {!isAnonymous ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={(e) => saveTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="text-sm font-semibold bg-transparent border-none outline-none text-[var(--fg)] min-w-0 flex-1 hover:bg-[var(--surface-hover)] focus:bg-[var(--surface)] px-2 py-1 rounded-lg transition-colors"
            />
          ) : (
            <span className="text-sm font-semibold px-2 py-1 truncate">{title}</span>
          )}
          {!isAnonymous && (
            <span className="hidden md:flex items-center gap-1.5 text-xs text-[var(--muted)] shrink-0">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: saveStatus === "saving" ? "var(--accent)" : "var(--forest)" }}
              />
              {saveStatus === "saving" ? "Saving..." : "Saved"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isAnonymous && (
            <>
              <div className="hidden md:flex items-center gap-1">
                <button
                  onClick={() => togglePanel("comments")}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                    sidePanel === "comments"
                      ? "text-[var(--fg)] font-semibold bg-[var(--surface)]"
                      : "text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                  }`}
                  style={{ fontFamily: "var(--font-section)", fontSize: "14px" }}
                >
                  Comments
                </button>
                <button
                  onClick={() => togglePanel("github")}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                    sidePanel === "github"
                      ? "text-[var(--fg)] font-semibold bg-[var(--surface)]"
                      : "text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                  }`}
                  style={{ fontFamily: "var(--font-section)", fontSize: "14px" }}
                >
                  GitHub
                </button>
              </div>
              {/* Mobile sidebar toggle */}
              <button
                onClick={() => togglePanel("comments")}
                className="md:hidden p-2 rounded-lg hover:bg-[var(--surface-hover)] transition-colors cursor-pointer text-[var(--muted)]"
                aria-label="Toggle sidebar"
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M7.5 8.25h9m-9 3.75h9m-9 3.75h9M3.75 3.75h16.5a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5V5.25a1.5 1.5 0 0 1 1.5-1.5Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <AuthButton />
              <SharePopover docId={id} shareMode={shareMode!} onShareModeChange={setShareMode} />
            </>
          )}
          {isAnonymous && (
            <>
              <AuthButton />
              {shareMode === "view" && (
                <span className="text-xs text-[var(--muted)] px-3 py-1.5 rounded-full bg-[var(--surface)] border border-[var(--border)]">
                  View only
                </span>
              )}
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col overflow-hidden py-4 px-2 md:py-8 md:px-4">
            <Editor
              docId={id}
              userName={userName}
              readOnly={readOnly}
              onSelectionComment={canEdit ? handleSelectionComment : undefined}
              onEditorReady={handleEditorReady}
              onReplacementReady={handleReplacementReady}
            />
          </div>
        </main>

        {/* Sidebar: inline on md+, full-width overlay on mobile */}
        {showSidebar && (
          <>
            {/* Mobile backdrop */}
            <div
              className="fixed inset-0 bg-black/30 z-[70] md:hidden"
              onClick={() => setSidePanel(null)}
            />
            <aside className="fixed inset-0 z-[80] flex flex-col bg-[var(--bg)] md:static md:inset-auto md:z-auto md:w-80 md:border-l md:border-[var(--border)] md:shrink-0">
              {/* Mobile header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0 md:hidden">
                <button
                  onClick={() => setSidePanel(null)}
                  className="flex items-center gap-2 text-sm font-medium text-[var(--fg)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                >
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M19 12H5m0 0 7-7m-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back to document
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {sidePanel === "comments" ? (
                  <SidebarTabs
                    docId={id}
                    userName={userName}
                    pendingAnchor={pendingAnchor}
                    onAnchorConsumed={handleAnchorConsumed}
                    getDocumentText={getDocumentText}
                    applyTextReplacement={applyTextReplacement}
                    onUndoEdit={handleUndoEdit}
                  />
                ) : (
                  <GitHubPanel docId={id} />
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

function SharePopover({
  docId,
  shareMode,
  onShareModeChange,
}: {
  docId: string;
  shareMode: ShareMode;
  onShareModeChange: (mode: ShareMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function updateMode(mode: ShareMode) {
    setSaving(true);
    try {
      const res = await fetch(`/api/canvas/docs/${docId}/sharing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) onShareModeChange(mode);
    } catch (err) {
      console.error("Failed to update share mode:", err);
    } finally {
      setSaving(false);
    }
  }

  function copyLink() {
    const url = `${window.location.origin}/doc/${docId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const options: { mode: ShareMode; label: string; desc: string }[] = [
    { mode: "none", label: "Private", desc: "Only signed-in users" },
    { mode: "view", label: "Anyone can view", desc: "Anonymous read-only access" },
    { mode: "edit", label: "Anyone can edit", desc: "Anonymous full access" },
  ];

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--fg)] text-[var(--bg)] hover:opacity-85 transition-all cursor-pointer"
      >
        Share
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 z-50"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <h3 className="text-sm font-semibold mb-3">Share this document</h3>

          <div className="space-y-1 mb-3">
            {options.map((opt) => (
              <button
                key={opt.mode}
                onClick={() => updateMode(opt.mode)}
                disabled={saving}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                  shareMode === opt.mode
                    ? "bg-[var(--accent-light)] text-[var(--accent)] font-medium"
                    : "hover:bg-[var(--surface-hover)] text-[var(--fg)]"
                }`}
              >
                <div className="font-medium text-xs">{opt.label}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>

          <button
            onClick={copyLink}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-xs font-medium hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}
