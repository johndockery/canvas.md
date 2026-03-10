"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AnchorData, ApplyTextReplacement } from "./Editor";

interface EditAction {
  id: string;
  title: string;
  description: string;
  originalText: string;
  newText: string;
  undone?: boolean;
}

interface Comment {
  id: string;
  userName: string;
  text: string;
  createdAt: string;
  isAgent?: boolean;
  editActions?: EditAction[];
  anchor?: {
    quote: string;
    context: string;
    from: number;
    to: number;
  } | null;
}

interface ApiComment {
  id: string;
  user_name: string;
  text: string;
  is_agent: boolean | number;
  anchor_quote: string | null;
  anchor_context: string | null;
  anchor_from: number | null;
  anchor_to: number | null;
  edit_actions: EditAction[] | string | null;
  created_at: string;
}

interface CommentsSidebarProps {
  docId: string;
  userName: string;
  pendingAnchor?: AnchorData | null;
  onAnchorConsumed?: () => void;
  getDocumentText?: () => string;
  applyTextReplacement?: ApplyTextReplacement | null;
  onUndoEdit?: (edit: EditAction) => void;
}

function parseEditActions(raw: EditAction[] | string | null): EditAction[] | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

function toComment(c: ApiComment): Comment {
  return {
    id: c.id,
    userName: c.user_name,
    text: c.text,
    createdAt: c.created_at,
    isAgent: !!c.is_agent,
    editActions: parseEditActions(c.edit_actions),
    anchor: c.anchor_quote
      ? {
          quote: c.anchor_quote,
          context: c.anchor_context || "",
          from: c.anchor_from || 0,
          to: c.anchor_to || 0,
        }
      : null,
  };
}

export default function CommentsSidebar({
  docId,
  userName,
  pendingAnchor,
  onAnchorConsumed,
  getDocumentText,
  applyTextReplacement,
  onUndoEdit,
}: CommentsSidebarProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [undoneEdits, setUndoneEdits] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/canvas/docs/${docId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments((data.comments || []).map(toComment));
      }
    } catch (err) {
      console.error("Failed to load comments:", err);
    }
  }, [docId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    if (pendingAnchor) {
      inputRef.current?.focus();
    }
  }, [pendingAnchor]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const handleUndoEdit = useCallback(
    (edit: EditAction) => {
      if (!applyTextReplacement) return;

      // Reverse the edit: find newText, replace with originalText
      const success = applyTextReplacement(edit.newText, edit.originalText);
      if (success) {
        setUndoneEdits((prev) => new Set(prev).add(edit.id));
        onUndoEdit?.(edit);
      } else {
        console.warn("Could not undo edit — the text may have changed:", edit.title);
      }
    },
    [applyTextReplacement, onUndoEdit]
  );

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const text = input.trim();
    setInput("");

    const body: Record<string, unknown> = {
      userName,
      text,
      isAgent: false,
    };

    if (pendingAnchor) {
      body.anchorQuote = pendingAnchor.quote;
      body.anchorContext = pendingAnchor.context;
      body.anchorFrom = pendingAnchor.from;
      body.anchorTo = pendingAnchor.to;
      onAnchorConsumed?.();
    }

    try {
      const res = await fetch(`/api/canvas/docs/${docId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        await fetchComments();
      }
    } catch (err) {
      console.error("Failed to save comment:", err);
    }

    // Check if the comment mentions @claude
    if (text.includes("@claude")) {
      setLoading(true);

      // Try agent-edit flow first (if we have document text access and replacement capability)
      const documentText = getDocumentText?.();
      if (documentText && applyTextReplacement) {
        try {
          const agentRes = await fetch("/api/agent-edit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId,
              instruction: text,
              documentText,
              userName,
            }),
          });

          if (agentRes.ok) {
            const data = await agentRes.json();

            if (data.edits && data.edits.length > 0) {
              // Apply each edit to the document
              for (const edit of data.edits) {
                applyTextReplacement(edit.originalText, edit.newText);
              }

              // Save the agent comment with structured edit actions
              await fetch(`/api/canvas/docs/${docId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userName: "Claude",
                  text: data.message,
                  isAgent: true,
                  editActions: data.edits,
                }),
              });
              await fetchComments();
              setLoading(false);
              return;
            }
          }
        } catch (err) {
          console.error("Agent-edit failed, falling back to regular agent:", err);
        }
      }

      // Fallback: regular agent comment flow
      try {
        const agentRes = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docId,
            commentText: text,
            userName,
            context: "comment",
          }),
        });

        if (agentRes.ok) {
          const data = await agentRes.json();
          if (data.response) {
            await fetch(`/api/canvas/docs/${docId}/comments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userName: "Claude",
                text: data.response,
                isAgent: true,
              }),
            });
            await fetchComments();
          }
        }
      } catch (err) {
        console.error("Agent comment failed:", err);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {comments.length === 0 && (
          <p className="text-xs text-[var(--muted)] text-center py-8 leading-relaxed">
            No comments yet. Select text to add anchored comments, or use @claude to tag the AI.
          </p>
        )}

        {comments.map((c) => (
          <div
            key={c.id}
            className="text-sm rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3"
          >
            {c.anchor && (
              <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg)] border-l-2 border-amber-400">
                <p className="text-xs text-[var(--muted)] italic truncate">
                  &ldquo;{c.anchor.quote}&rdquo;
                </p>
              </div>
            )}
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`font-semibold text-xs ${
                  c.isAgent ? "text-[var(--accent)]" : ""
                }`}
              >
                {c.userName}
                {c.isAgent && " (AI)"}
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                {new Date(c.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-[var(--fg)] whitespace-pre-wrap text-xs leading-relaxed">{c.text}</p>

            {/* Render structured edit actions if present */}
            {c.editActions && c.editActions.length > 0 && (
              <div className="mt-2 space-y-2">
                {c.editActions.map((edit) => {
                  const isUndone = edit.undone || undoneEdits.has(edit.id);
                  return (
                    <div
                      key={edit.id}
                      className="edit-action-card"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="edit-action-title">{edit.title}</p>
                          <p className="edit-action-description">{edit.description}</p>
                        </div>
                        <div className="shrink-0 pt-0.5">
                          {isUndone ? (
                            <span className="edit-action-undone-label">Undone</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleUndoEdit(edit)}
                              className="edit-action-undo-btn"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="text-xs text-[var(--muted)] flex items-center gap-2 px-3 py-2">
            <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            Claude is editing...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={addComment}
        className="p-3 border-t border-[var(--border)]"
      >
        {pendingAnchor && (
          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs">
            <span className="text-[var(--muted)]">Commenting on: </span>
            <span className="italic truncate">&ldquo;{pendingAnchor.quote}&rdquo;</span>
            <button
              type="button"
              onClick={() => onAnchorConsumed?.()}
              className="ml-2 text-[var(--muted)] hover:text-red-500 cursor-pointer"
            >
              &times;
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              pendingAnchor
                ? "Add your comment on the selected text..."
                : "Comment... (@claude to tag AI)"
            }
            className="flex-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-2 rounded-xl bg-[var(--fg)] text-[var(--bg)] text-xs font-medium hover:opacity-85 transition-all disabled:opacity-50 cursor-pointer"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
