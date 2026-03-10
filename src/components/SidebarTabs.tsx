"use client";

import { useState, useEffect } from "react";
import type { AnchorData, ApplyTextReplacement } from "./Editor";
import CommentsSidebar from "./CommentsSidebar";
import ChatPanel from "./ChatPanel";

interface EditAction {
  id: string;
  title: string;
  description: string;
  originalText: string;
  newText: string;
  undone?: boolean;
}

type Tab = "chat" | "comments";

interface SidebarTabsProps {
  docId: string;
  userName: string;
  pendingAnchor?: AnchorData | null;
  onAnchorConsumed?: () => void;
  getDocumentText?: () => string;
  applyTextReplacement?: ApplyTextReplacement | null;
  onUndoEdit?: (edit: EditAction) => void;
}

export default function SidebarTabs({
  docId,
  userName,
  pendingAnchor,
  onAnchorConsumed,
  getDocumentText,
  applyTextReplacement,
  onUndoEdit,
}: SidebarTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  // Auto-switch to Comments when user selects text to comment
  useEffect(() => {
    if (pendingAnchor) {
      setActiveTab("comments");
    }
  }, [pendingAnchor]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[var(--border)]">
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex-1 px-4 py-2.5 text-[13px] font-semibold transition-colors cursor-pointer ${
            activeTab === "chat"
              ? "text-[var(--fg)] border-b-2 border-[var(--fg)]"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
          style={{ fontFamily: "var(--font-section)" }}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab("comments")}
          className={`flex-1 px-4 py-2.5 text-[13px] font-semibold transition-colors cursor-pointer ${
            activeTab === "comments"
              ? "text-[var(--fg)] border-b-2 border-[var(--fg)]"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
          style={{ fontFamily: "var(--font-section)" }}
        >
          Comments
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "chat" ? (
          <ChatPanel
            docId={docId}
            userName={userName}
            getDocumentText={getDocumentText}
            applyTextReplacement={applyTextReplacement}
          />
        ) : (
          <CommentsSidebar
            docId={docId}
            userName={userName}
            pendingAnchor={pendingAnchor}
            onAnchorConsumed={onAnchorConsumed}
            getDocumentText={getDocumentText}
            applyTextReplacement={applyTextReplacement}
            onUndoEdit={onUndoEdit}
          />
        )}
      </div>
    </div>
  );
}
