"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ApplyTextReplacement } from "./Editor";

interface EditAction {
  id: string;
  title: string;
  description: string;
  originalText: string;
  newText: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  editActions?: EditAction[];
}

interface ChatPanelProps {
  docId: string;
  userName: string;
  getDocumentText?: () => string;
  applyTextReplacement?: ApplyTextReplacement | null;
}

export default function ChatPanel({
  docId,
  userName,
  getDocumentText,
  applyTextReplacement,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [undoneEdits, setUndoneEdits] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted chat messages on mount
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/canvas/docs/${docId}/chat`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const msgs: ChatMessage[] = (data.messages || []).map(
          (m: { id: string; role: string; content: string; edit_actions?: unknown }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            editActions: m.edit_actions as EditAction[] | undefined,
          })
        );
        setMessages(msgs);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [docId]);

  function persistMessage(msg: ChatMessage) {
    fetch(`/api/canvas/docs/${docId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        editActions: msg.editActions,
      }),
    }).catch(() => {});
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
    persistMessage(msg);
  }

  const handleUndoEdit = useCallback(
    (edit: EditAction) => {
      if (!applyTextReplacement) return;
      const success = applyTextReplacement(edit.newText, edit.originalText);
      if (success) {
        setUndoneEdits((prev) => new Set(prev).add(edit.id));
      } else {
        console.warn("Could not undo edit — the text may have changed:", edit.title);
      }
    },
    [applyTextReplacement]
  );

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setProgressText("");
  }

  function formatProgressLabel(event: { tool: string; input: Record<string, string> }): string {
    switch (event.tool) {
      case "list_directory":
        return `Browsing ${event.input.repo || "repo"}/${event.input.path || ""}...`;
      case "read_file":
        return `Reading ${event.input.path || "file"}...`;
      case "search_code":
        return `Searching for '${event.input.query || ""}'...`;
      default:
        return `Running ${event.tool}...`;
    }
  }

  async function readSSEResponse<T>(
    response: Response,
    onResult: (data: T) => void,
    onEditDelta?: (data: { editIndex: number; originalText: string; delta: string }) => void,
  ) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function processEvent(block: string) {
      let eventType = "";
      let eventData = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          eventData = line.slice(6);
        }
      }
      if (!eventData) return;
      try {
        const parsed = JSON.parse(eventData);
        if (eventType === "edit_delta") {
          onEditDelta?.(parsed);
        } else if (eventType === "progress") {
          setProgressText(formatProgressLabel(parsed));
        } else if (eventType === "result") {
          onResult(parsed);
        }
      } catch (e) {
        console.error("SSE parse error:", e);
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by double newlines — only process
      // complete events so we never JSON.parse a partial data line.
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const eventBlock = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processEvent(eventBlock);
      }
    }

    // Process any remaining event after stream ends
    if (buffer.trim()) {
      processEvent(buffer);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const text = input.trim();
    setInput("");

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    persistMessage(userMsg);
    setLoading(true);
    setProgressText("");
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    // Build API messages array (role + content only, truncated to last 20)
    const apiMessages = updatedMessages.slice(-20).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const documentText = getDocumentText?.() ?? "";

    // Try agent-edit first if we can apply edits
    if (applyTextReplacement) {
      try {
        const docDescription = documentText
          ? `Here is the current document text:\n\n---\n${documentText}\n---`
          : "The document is currently empty.";

        // Build the last user message with document context for the edit endpoint
        const editApiMessages = [
          ...apiMessages.slice(0, -1),
          {
            role: "user" as const,
            content: `${docDescription}\n\nUser "${userName}" instruction: ${text}\n\nPlease call the apply_edits tool with your structured edits.`,
          },
        ];

        const agentRes = await fetch("/api/agent-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docId,
            instruction: text,
            documentText: documentText || "(empty document)",
            userName,
            messages: editApiMessages,
            stream: true,
          }),
          signal,
        });

        if (agentRes.ok) {
          // SSE streaming path
          if (agentRes.headers.get("content-type")?.includes("text/event-stream")) {
            let sseHandled = false;

            // Streaming edit state for progressive editor updates
            const streamState = {
              edits: new Map<number, { originalText: string; accumulated: string; applied: boolean }>(),
              lastApplied: "",
              rafId: 0,
            };

            function startApplyLoop() {
              const MIN_INTERVAL = 80; // ms between editor updates
              const MIN_CHARS = 20;    // min new chars before applying
              let lastTime = 0;

              function tick(ts: number) {
                // Only stream edit index 0 during generation
                const edit = streamState.edits.get(0);
                if (!edit) {
                  streamState.rafId = requestAnimationFrame(tick);
                  return;
                }

                const elapsed = ts - lastTime;
                const pending = edit.accumulated.length - streamState.lastApplied.length;

                if (elapsed >= MIN_INTERVAL && pending >= MIN_CHARS) {
                  if (!edit.applied) {
                    // First apply: replace originalText with partial accumulated text
                    const ok = applyTextReplacement!(edit.originalText, edit.accumulated);
                    if (ok) {
                      edit.applied = true;
                      streamState.lastApplied = edit.accumulated;
                    }
                  } else {
                    // Subsequent: replace previously-applied partial with longer accumulated
                    const ok = applyTextReplacement!(streamState.lastApplied, edit.accumulated);
                    if (ok) {
                      streamState.lastApplied = edit.accumulated;
                    }
                  }
                  lastTime = ts;
                }
                streamState.rafId = requestAnimationFrame(tick);
              }
              streamState.rafId = requestAnimationFrame(tick);
            }

            // Helper: try to apply an edit, with empty-doc retry fallback
            function tryApplyEdit(origText: string, newText: string, title: string): boolean {
              let ok = applyTextReplacement!(origText, newText);
              if (!ok) {
                const currentDoc = getDocumentText?.() ?? "";
                if (currentDoc.trim() === "" && origText !== "") {
                  console.warn("[agent-edit] Retrying with empty originalText for:", title);
                  ok = applyTextReplacement!("", newText);
                }
                if (!ok) {
                  console.warn("[agent-edit] Failed to apply edit:", title);
                }
              }
              return ok;
            }

            // Helper: salvage any partial edit content from the stream
            function salvageStreamedEdits(): boolean {
              const edit = streamState.edits.get(0);
              if (!edit || !edit.accumulated || edit.accumulated.length < 50) return false;
              console.log("[agent-edit] Salvaging partial streamed content, length:", edit.accumulated.length);
              if (edit.applied) {
                // Already partially applied — finalize with what we have
                applyTextReplacement!(streamState.lastApplied, edit.accumulated);
              } else {
                tryApplyEdit(edit.originalText, edit.accumulated, "Partial content (connection lost)");
              }
              const assistantMsg: ChatMessage = {
                id: `msg-${Date.now()}-a`,
                role: "assistant",
                content: "Connection was interrupted. Partial content has been saved to the document.",
              };
              addMessage(assistantMsg);
              return true;
            }

            try {
              await readSSEResponse<{ message?: string; edits?: EditAction[]; error?: string }>(
                agentRes,
                (data) => {
                  // Cancel RAF loop
                  if (streamState.rafId) {
                    cancelAnimationFrame(streamState.rafId);
                    streamState.rafId = 0;
                  }

                  setProgressText("");
                  if (data.error) {
                    console.error("[agent-edit] SSE error:", data.error);
                    const errorMsg: ChatMessage = {
                      id: `msg-${Date.now()}-a`,
                      role: "assistant",
                      content: `Sorry, an error occurred: ${data.error}`,
                    };
                    addMessage(errorMsg);
                    sseHandled = true;
                    return;
                  }
                  if (data.edits && data.edits.length > 0) {
                    let failedCount = 0;

                    // Finalize edit 0: apply authoritative text
                    const streamedEdit = streamState.edits.get(0);
                    if (streamedEdit?.applied && data.edits[0]) {
                      const ok = applyTextReplacement!(streamState.lastApplied, data.edits[0].newText);
                      if (!ok) {
                        // Streaming got out of sync — try full replacement
                        if (!tryApplyEdit(data.edits[0].originalText, data.edits[0].newText, data.edits[0].title)) failedCount++;
                      }
                    } else if (data.edits[0]) {
                      if (!tryApplyEdit(data.edits[0].originalText, data.edits[0].newText, data.edits[0].title)) failedCount++;
                    }

                    // Apply remaining edits (1+)
                    for (let i = 1; i < data.edits.length; i++) {
                      const edit = data.edits[i];
                      if (!tryApplyEdit(edit.originalText, edit.newText, edit.title)) failedCount++;
                    }

                    const msgContent = failedCount > 0
                      ? `${data.message || ""}\n\n(${failedCount} edit${failedCount > 1 ? "s" : ""} failed to apply — the document may have changed)`
                      : (data.message || "");

                    const assistantMsg: ChatMessage = {
                      id: `msg-${Date.now()}-a`,
                      role: "assistant",
                      content: msgContent,
                      editActions: data.edits,
                    };
                    addMessage(assistantMsg);
                    sseHandled = true;
                  } else if (data.message) {
                    console.warn("[agent-edit] Response had message but no edits:", data.message.substring(0, 100));
                    const assistantMsg: ChatMessage = {
                      id: `msg-${Date.now()}-a`,
                      role: "assistant",
                      content: data.message,
                    };
                    addMessage(assistantMsg);
                    sseHandled = true;
                  }
                },
                // onEditDelta: accumulate streaming text and start apply loop
                (deltaData) => {
                  const { editIndex, originalText, delta } = deltaData;
                  if (!delta) return;
                  let entry = streamState.edits.get(editIndex);
                  if (!entry) {
                    entry = { originalText, accumulated: "", applied: false };
                    streamState.edits.set(editIndex, entry);
                  }
                  entry.accumulated += delta;

                  // Show writing progress and start apply loop
                  if (!streamState.rafId) {
                    setProgressText("Writing...");
                    startApplyLoop();
                  }
                },
              );
            } catch (sseErr) {
              // SSE stream died (network error, etc). Salvage any partial content.
              console.error("[agent-edit] SSE stream interrupted:", sseErr);
              if (streamState.rafId) {
                cancelAnimationFrame(streamState.rafId);
                streamState.rafId = 0;
              }
              if (salvageStreamedEdits()) {
                setLoading(false);
                return;
              }
              // No partial content to salvage — fall through to regular agent
              throw sseErr;
            }
            if (!sseHandled) {
              console.warn("[agent-edit] SSE stream ended without a result event");
              if (streamState.rafId) {
                cancelAnimationFrame(streamState.rafId);
              }
              // Try salvaging any partial streamed edits
              if (salvageStreamedEdits()) {
                setLoading(false);
                return;
              }
            }
            setLoading(false);
            return;
          }

          // Non-streaming JSON fallback
          const data = await agentRes.json();
          if (data.edits && data.edits.length > 0) {
            let failedCount = 0;
            for (const edit of data.edits) {
              let success = applyTextReplacement(edit.originalText, edit.newText);
              if (!success) {
                // Retry: if document appears empty, try with "" as originalText
                const currentDoc = getDocumentText?.() ?? "";
                if (currentDoc.trim() === "" && edit.originalText !== "") {
                  console.warn("[agent-edit] Retrying with empty originalText for:", edit.title);
                  success = applyTextReplacement("", edit.newText);
                }
                if (!success) {
                  console.warn("[agent-edit] Failed to apply edit:", edit.title);
                  failedCount++;
                }
              }
            }
            const msgContent = failedCount > 0
              ? `${data.message || ""}\n\n(${failedCount} edit${failedCount > 1 ? "s" : ""} failed to apply — the document may have changed)`
              : (data.message || "");
            const assistantMsg: ChatMessage = {
              id: `msg-${Date.now()}-a`,
              role: "assistant",
              content: msgContent,
              editActions: data.edits,
            };
            addMessage(assistantMsg);
            setLoading(false);
            return;
          }
          // Agent-edit returned text but no structured edits (e.g. after
          // repo exploration that exhausted turns). Show the response in
          // chat rather than re-exploring with the fallback agent.
          if (data.message) {
            console.warn("[agent-edit] Response had message but no edits:", data.message.substring(0, 100));
            const assistantMsg: ChatMessage = {
              id: `msg-${Date.now()}-a`,
              role: "assistant",
              content: data.message,
            };
            addMessage(assistantMsg);
            setLoading(false);
            return;
          }
        } else {
          // Agent-edit returned non-OK status — fall through to regular agent
          const errBody = await agentRes.text().catch(() => "");
          console.error("[agent-edit] Non-OK response:", agentRes.status, errBody.substring(0, 200));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setLoading(false);
          return;
        }
        console.error("[agent-edit] Exception, falling back to regular agent:", err);
      }
    } else {
      console.warn("[agent-edit] applyTextReplacement is not available, using regular agent");
    }

    // Fallback: regular agent chat (no document editing capability)
    try {
      const docContext = documentText
        ? `[Document context]\n${documentText}\n[End document context]`
        : "[Document context]\nThe document is currently empty.\n[End document context]";

      const chatApiMessages = [
        {
          role: "user" as const,
          content: docContext,
        },
        { role: "assistant" as const, content: "I can see the document. How can I help?" },
        ...apiMessages,
      ];

      const agentRes = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          userName,
          context: "chat",
          messages: chatApiMessages,
          stream: true,
        }),
        signal,
      });

      if (agentRes.ok) {
        // SSE streaming path
        if (agentRes.headers.get("content-type")?.includes("text/event-stream")) {
          await readSSEResponse<{ response?: string; error?: string }>(
            agentRes,
            (data) => {
              setProgressText("");
              if (data.response) {
                const assistantMsg: ChatMessage = {
                  id: `msg-${Date.now()}-a`,
                  role: "assistant",
                  content: data.response,
                };
                addMessage(assistantMsg);
              }
            }
          );
        } else {
          // Non-streaming JSON fallback
          const data = await agentRes.json();
          if (data.response) {
            const assistantMsg: ChatMessage = {
              id: `msg-${Date.now()}-a`,
              role: "assistant",
              content: data.response,
            };
            addMessage(assistantMsg);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setLoading(false);
        return;
      }
      console.error("Chat agent failed:", err);
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
      };
      addMessage(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 px-4">
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Ask Claude about this document — get answers, request edits, or brainstorm ideas.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            {m.role === "assistant" && (
              <div className="flex items-center gap-2 mb-1.5 mr-6">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-white text-[9px] font-bold"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  C
                </span>
                <span className="text-xs font-semibold text-[var(--muted)]">Claude</span>
              </div>
            )}
            <div
              className={`text-sm p-3 ${
                m.role === "user"
                  ? "bg-[var(--fg)] text-[var(--bg)] rounded-2xl ml-6"
                  : "bg-[var(--surface)] border border-[var(--border)] rounded-xl mr-6"
              }`}
            >
              <p className={`whitespace-pre-wrap text-xs leading-relaxed ${
                m.role === "user" ? "text-[var(--bg)]" : "text-[var(--fg)]"
              }`}>
                {m.content}
              </p>

              {m.editActions && m.editActions.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.editActions.map((edit) => {
                    const isUndone = undoneEdits.has(edit.id);
                    return (
                      <div key={edit.id} className="edit-action-card">
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
          </div>
        ))}

        {loading && (
          <div className="text-xs text-[var(--muted)] flex items-center gap-2 px-3 py-2">
            <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="flex-1">{progressText || "Claude is thinking..."}</span>
            <button
              type="button"
              onClick={handleStop}
              className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors px-2 py-0.5 rounded border border-[var(--border)] hover:border-[var(--fg)] cursor-pointer"
            >
              Stop
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t border-[var(--border)]">
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Claude about this document..."
            disabled={loading}
            className="w-full pl-3.5 pr-10 py-2.5 rounded-full border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)] transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="absolute right-1.5 w-7 h-7 rounded-full bg-[var(--fg)] text-[var(--bg)] flex items-center justify-center hover:opacity-85 transition-all disabled:opacity-30 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
