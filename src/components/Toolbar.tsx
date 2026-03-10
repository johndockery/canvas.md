"use client";

import type { CmdKey } from "@milkdown/kit/core";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInBlockquoteCommand,
  toggleInlineCodeCommand,
} from "@milkdown/kit/preset/commonmark";

interface ToolbarProps {
  callCommand: <T>(key: CmdKey<T>, payload?: T) => void;
}

export default function Toolbar({ callCommand }: ToolbarProps) {
  const btnClass =
    "px-2.5 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] whitespace-nowrap";

  const divider = (
    <div className="w-px h-4 bg-[var(--border)] mx-1" />
  );

  return (
    <div className="flex items-center gap-0.5 mb-3 flex-nowrap overflow-x-auto px-1 py-1.5 shrink-0">

      <button onClick={() => callCommand(wrapInHeadingCommand.key, 1)} className={btnClass}>
        H1
      </button>
      <button onClick={() => callCommand(wrapInHeadingCommand.key, 2)} className={btnClass}>
        H2
      </button>
      <button onClick={() => callCommand(wrapInHeadingCommand.key, 3)} className={btnClass}>
        H3
      </button>

      {divider}

      <button onClick={() => callCommand(toggleStrongCommand.key)} className={btnClass}>
        <strong>B</strong>
      </button>
      <button onClick={() => callCommand(toggleEmphasisCommand.key)} className={btnClass}>
        <em>I</em>
      </button>
      <button onClick={() => callCommand(toggleInlineCodeCommand.key)} className={btnClass}>
        Code
      </button>

      {divider}

      <button onClick={() => callCommand(wrapInBulletListCommand.key)} className={btnClass}>
        List
      </button>
      <button onClick={() => callCommand(wrapInBlockquoteCommand.key)} className={btnClass}>
        Quote
      </button>
    </div>
  );
}
