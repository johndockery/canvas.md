"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  MilkdownProvider,
  Milkdown,
  useEditor,
  useInstance,
} from "@milkdown/react";
import { Editor as MilkdownEditor, rootCtx, editorViewCtx, editorViewOptionsCtx, rootAttrsCtx, editorStateCtx } from "@milkdown/kit/core";
import { prosePluginsCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import { getMarkdown, callCommand } from "@milkdown/kit/utils";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import Toolbar from "./Toolbar";

function getCollabUrl() {
  if (process.env.NEXT_PUBLIC_COLLAB_URL) return process.env.NEXT_PUBLIC_COLLAB_URL;
  if (typeof window === "undefined") return "ws://localhost:1234";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/collab`;
}

export interface AnchorData {
  quote: string;
  context: string;
  from: number;
  to: number;
}

export type ApplyTextReplacement = (originalText: string, newText: string) => boolean;

interface CommentRange {
  from: number;
  to: number;
  commentId: string;
}

interface EditorProps {
  docId: string;
  userName: string;
  readOnly?: boolean;
  commentRanges?: CommentRange[];
  onSelectionComment?: (anchor: AnchorData) => void;
  onEditorReady?: (helpers: { getText: () => string }) => void;
  onReplacementReady?: (applyFn: ApplyTextReplacement) => void;
}

export default function Editor({
  docId,
  userName,
  readOnly,
  commentRanges,
  onSelectionComment,
  onEditorReady,
  onReplacementReady,
}: EditorProps) {
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: getCollabUrl(),
      name: docId,
      document: ydoc,
      onStatus({ status: s }) {
        setStatus(
          s === "connected" ? "connected" : s === "connecting" ? "connecting" : "disconnected"
        );
      },
      onAwarenessUpdate({ states }) {
        const users = Array.from(states.values())
          .map((s: Record<string, unknown>) => (s.user as { name?: string })?.name)
          .filter((name): name is string => !!name && name !== userName);
        setConnectedUsers([...new Set(users)]);
      },
    });

    provider.setAwarenessField("user", {
      name: userName,
      color: stringToColor(userName),
    });

    ydocRef.current = ydoc;
    providerRef.current = provider;
    setReady(true);

    return () => {
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
    };
  }, [docId, userName]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[300px] md:min-h-[500px] text-[var(--muted)]">
        Connecting...
      </div>
    );
  }

  return (
    <MilkdownProvider>
      <EditorInner
        ydoc={ydocRef.current!}
        provider={providerRef.current!}
        docId={docId}
        userName={userName}
        readOnly={readOnly}
        commentRanges={commentRanges}
        status={status}
        connectedUsers={connectedUsers}
        onSelectionComment={onSelectionComment}
        onEditorReady={onEditorReady}
        onReplacementReady={onReplacementReady}
      />
    </MilkdownProvider>
  );
}

// Track @claude mentions and trigger agent flow
const processedGlobal = new Set<string>();

// Comment highlight ProseMirror plugin key
const commentHighlightPluginKey = new PluginKey("commentHighlight");

function EditorInner({
  ydoc,
  provider,
  docId,
  userName,
  readOnly,
  commentRanges,
  status,
  connectedUsers,
  onSelectionComment,
  onEditorReady,
  onReplacementReady,
}: {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  docId: string;
  userName: string;
  readOnly?: boolean;
  commentRanges?: CommentRange[];
  status: "connecting" | "connected" | "disconnected";
  connectedUsers: string[];
  onSelectionComment?: (anchor: AnchorData) => void;
  onEditorReady?: (helpers: { getText: () => string }) => void;
  onReplacementReady?: (applyFn: ApplyTextReplacement) => void;
}) {
  const [showCommentButton, setShowCommentButton] = useState(false);
  const [selectionCoords, setSelectionCoords] = useState<{ top: number; left: number } | null>(null);
  const selectionAnchorRef = useRef<AnchorData | null>(null);

  // Track processed @claude mentions
  const processedMentionsRef = useRef<Set<number>>(new Set());

  // Store callbacks in refs for stable access
  const onEditorReadyRef = useRef(onEditorReady);
  const onReplacementReadyRef = useRef(onReplacementReady);
  const onSelectionCommentRef = useRef(onSelectionComment);
  onEditorReadyRef.current = onEditorReady;
  onReplacementReadyRef.current = onReplacementReady;
  onSelectionCommentRef.current = onSelectionComment;

  // Track whether collab has been connected
  const collabConnectedRef = useRef(false);
  // Track last synced markdown to avoid infinite loops
  const lastSyncedMarkdownRef = useRef<string>("");

  // Comment highlight plugin via $prose
  const commentHighlightPlugin = $prose(() => {
    return new Plugin({
      key: commentHighlightPluginKey,
      state: {
        init() {
          return DecorationSet.empty;
        },
        apply(tr, old) {
          const meta = tr.getMeta(commentHighlightPluginKey);
          if (meta) {
            const ranges: CommentRange[] = meta;
            const decorations = ranges
              .filter((r) => r.from < r.to && r.from >= 0 && r.to <= tr.doc.content.size)
              .sort((a, b) => a.from - b.from)
              .map((r) =>
                Decoration.inline(r.from, r.to, { class: "cm-comment-highlight" })
              );
            return DecorationSet.create(tr.doc, decorations);
          }
          return old.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations(state) {
          return this.getState(state) ?? DecorationSet.empty;
        },
      },
    });
  });

  // Selection tracking plugin for comment button
  const selectionTrackPlugin = $prose(() => {
    return new Plugin({
      view() {
        return {
          update(view) {
            if (readOnly || !onSelectionCommentRef.current) {
              setShowCommentButton(false);
              return;
            }

            const { from, to } = view.state.selection;
            if (from === to) {
              setShowCommentButton(false);
              selectionAnchorRef.current = null;
              return;
            }

            const selectedText = view.state.doc.textBetween(from, to, "\n");
            if (!selectedText.trim()) {
              setShowCommentButton(false);
              return;
            }

            const contextFrom = Math.max(0, from - 50);
            const contextTo = Math.min(view.state.doc.content.size, to + 50);
            const context = view.state.doc.textBetween(contextFrom, contextTo, "\n");

            selectionAnchorRef.current = {
              quote: selectedText,
              context,
              from,
              to,
            };

            const coords = view.coordsAtPos(from);
            if (coords) {
              setSelectionCoords({ top: coords.top - 40, left: coords.left });
              setShowCommentButton(true);
            }
          },
        };
      },
    });
  });

  useEditor((root) => {
    const editor = MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(rootAttrsCtx, {
          "data-testid": "milkdown-editor",
          spellcheck: "true",
        });
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => !readOnly,
          attributes: {
            class: "milkdown-editor",
            "data-placeholder": readOnly
              ? ""
              : "Start writing... Type @claude to tag the AI agent",
          },
        }));

        // Configure listener for markdown sync + @claude detection
        ctx.get(listenerCtx)
          .markdownUpdated((ctx, markdown, prevMarkdown) => {
            if (markdown === prevMarkdown) return;

            // Sync markdown to Y.Text("markdown") for server API access
            const ytext = ydoc.getText("markdown");
            if (markdown !== lastSyncedMarkdownRef.current) {
              lastSyncedMarkdownRef.current = markdown;
              ydoc.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, markdown);
              }, "milkdown-sync");
            }

            // @claude mention detection
            if (!readOnly) {
              checkForAtClaude(markdown, docId, userName, processedMentionsRef.current);
            }
          });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(collab)
      .use(commentHighlightPlugin)
      .use(selectionTrackPlugin);

    return editor;
  }, [ydoc, provider, readOnly, docId, userName]);

  // Get editor instance for imperative actions
  const [loading, getInstance] = useInstance();

  // Connect collab after editor is ready AND provider has synced
  useEffect(() => {
    if (loading) return;
    if (collabConnectedRef.current) return;

    const editor = getInstance();
    if (!editor) return;

    function connectCollab() {
      if (collabConnectedRef.current) return;
      try {
        // Patch Milkdown's STATE_TRACKER plugin to not crash on ctx.set(editorStateCtx).
        // The original plugin's apply() calls ctx.set(editorStateCtx, newState) which throws
        // "Context 'editorState' not found" after collab reconfigures ProseMirror plugins.
        // This prevents ALL view.dispatch() calls from working (including ySyncPlugin).
        const existingPlugins = editor!.ctx.get(prosePluginsCtx);
        const patchedPlugins = existingPlugins.map((p: Plugin) => {
          if (p.spec.key && (p.spec.key as unknown as { key: string }).key === "MILKDOWN_STATE_TRACKER$") {
            return new Plugin({
              key: p.spec.key as PluginKey,
              state: {
                init: () => { /* no-op */ },
                apply: (_tr, _value, _oldState, newState) => {
                  try {
                    editor!.ctx.set(editorStateCtx, newState);
                  } catch {
                    // Suppress editorStateCtx not found error
                  }
                },
              },
            });
          }
          return p;
        });
        editor!.ctx.set(prosePluginsCtx, patchedPlugins);

        const collabService = editor!.ctx.get(collabServiceCtx);
        collabService.bindDoc(ydoc);
        if (provider.awareness) {
          collabService.setAwareness(provider.awareness);
        }

        // Seed from Y.Text("markdown") if the XmlFragment is empty (first load)
        const ytext = ydoc.getText("markdown");
        const markdownContent = ytext.toString();
        if (markdownContent) {
          collabService.applyTemplate(markdownContent);
          lastSyncedMarkdownRef.current = markdownContent;
        }

        collabService.connect();
        collabConnectedRef.current = true;
      } catch (err) {
        console.error("[Editor] Failed to connect collab:", err);
      }
    }

    // If already synced, connect immediately; otherwise wait for sync
    if (provider.isSynced) {
      connectCollab();
    } else {
      const onSync = () => {
        connectCollab();
        provider.off("synced", onSync);
      };
      provider.on("synced", onSync);
      return () => { provider.off("synced", onSync); };
    }
  }, [loading, getInstance, ydoc, provider]);

  // Register callbacks once editor is ready
  useEffect(() => {
    if (loading) return;
    const editor = getInstance();
    if (!editor) return;

    if (onEditorReadyRef.current) {
      onEditorReadyRef.current({
        getText: () => {
          try {
            return editor.action(getMarkdown());
          } catch {
            return "";
          }
        },
      });
    }

    if (onReplacementReadyRef.current) {
      const applyTextReplacement: ApplyTextReplacement = (originalText, newText) => {
        try {
          const currentMarkdown = editor.action(getMarkdown());

          let targetMarkdown: string;
          if (originalText === "") {
            targetMarkdown = newText;
          } else {
            const idx = currentMarkdown.indexOf(originalText);
            if (idx === -1) {
              console.warn(
                "[Editor] Could not find originalText in doc. Doc length:",
                currentMarkdown.length,
                "Search length:",
                originalText.length,
                "First 80 chars:",
                JSON.stringify(originalText.substring(0, 80))
              );
              return false;
            }
            targetMarkdown =
              currentMarkdown.slice(0, idx) +
              newText +
              currentMarkdown.slice(idx + originalText.length);
          }

          console.log("[Editor] Applying replacement via Yjs collab service, target length:", targetMarkdown.length);

          // Write directly to Yjs via the collab service's applyTemplate method.
          // This bypasses ProseMirror view.dispatch() which crashes with
          // "editorState not found" when collab plugins are active.
          // applyTemplate parses markdown, writes to Y.XmlFragment, and
          // ySyncPlugin automatically propagates the change to ProseMirror.
          const collabService = editor.ctx.get(collabServiceCtx);
          collabService.applyTemplate(targetMarkdown, () => true);

          console.log("[Editor] Replacement via Yjs succeeded");
          return true;
        } catch (err) {
          console.error("[Editor] applyTextReplacement error:", err);
          return false;
        }
      };

      console.log("[Editor] Registered applyTextReplacement");
      onReplacementReadyRef.current(applyTextReplacement);
    }
  }, [loading, getInstance]);

  // Update comment decorations when commentRanges change
  useEffect(() => {
    if (loading || !commentRanges) return;
    const editor = getInstance();
    if (!editor) return;

    try {
      const view = editor.ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.setMeta(commentHighlightPluginKey, commentRanges)
      );
    } catch (err) {
      console.error("[Editor] Failed to update comment decorations:", err);
    }
  }, [commentRanges, loading, getInstance]);

  const handleCommentClick = useCallback(() => {
    if (selectionAnchorRef.current && onSelectionComment) {
      onSelectionComment(selectionAnchorRef.current);
      setShowCommentButton(false);
    }
  }, [onSelectionComment]);

  return (
    <div className="relative flex flex-col flex-1 overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              status === "connected"
                ? "bg-emerald-500"
                : status === "connecting"
                ? "bg-amber-500"
                : "bg-red-500"
            }`}
          />
          <span className="text-xs text-[var(--muted)]">
            {status === "connected"
              ? connectedUsers.length > 0
                ? connectedUsers.map((u, i) => (
                    <span key={u}>
                      {i > 0 && ", "}
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[10px] font-medium">
                        {u}
                      </span>
                    </span>
                  ))
                : "Connected"
              : status}
          </span>
        </div>
      </div>

      {/* Toolbar (hidden in read-only mode) */}
      {!readOnly && <ToolbarWrapper />}

      {/* Editor container */}
      <div className="milkdown-container flex-1 overflow-y-auto">
        <Milkdown />
      </div>

      {/* Comment button on selection (hidden in read-only mode) */}
      {!readOnly && showCommentButton && selectionCoords && (
        <button
          onClick={handleCommentClick}
          className="fixed z-50 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--fg)] text-[var(--bg)] hover:opacity-85 transition-all cursor-pointer"
          style={{
            top: `${selectionCoords.top}px`,
            left: `${selectionCoords.left}px`,
            boxShadow: "var(--shadow-lg)",
          }}
        >
          Comment
        </button>
      )}
    </div>
  );
}

// Toolbar wrapper that uses useInstance() within MilkdownProvider
function ToolbarWrapper() {
  const [loading, getInstance] = useInstance();

  if (loading) return null;

  return (
    <Toolbar
      callCommand={(key, payload) => {
        const editor = getInstance();
        if (!editor) return;
        editor.action(callCommand(key, payload));
      }}
    />
  );
}

async function checkForAtClaude(
  text: string,
  docId: string,
  userName: string,
  processedSet: Set<number>
) {
  const pattern = /@claude/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const pos = match.index;
    if (processedSet.has(pos)) continue;
    processedSet.add(pos);

    const key = `${docId}:${pos}:${text.substring(Math.max(0, pos - 20), pos + 20)}`;
    if (processedGlobal.has(key)) continue;
    processedGlobal.add(key);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, documentText: text, userName }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.response) {
          console.log("[Editor] @claude response received:", data.response.substring(0, 80));
        }
      }
    } catch (err) {
      console.error("Agent request failed:", err);
    }
  }
}

function stringToColor(str: string): string {
  const colors = [
    "#c4703f", "#8b7355", "#b5845a", "#6b8e6b",
    "#7c8b6f", "#a0856e", "#6f8a8f", "#9b7c5c",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
