"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function AuthButton() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (status === "loading") {
    return <span className="text-sm text-[var(--muted)]">...</span>;
  }

  if (!session) {
    return (
      <button
        onClick={() => signIn("google")}
        className="px-4 py-2 rounded-xl bg-[var(--fg)] text-[var(--bg)] text-xs font-medium hover:opacity-85 transition-all cursor-pointer"
      >
        Sign in with Google
      </button>
    );
  }

  const name = session.user?.name || "";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 cursor-pointer rounded-lg px-1.5 py-1 hover:bg-[var(--surface-hover)] transition-colors"
      >
        {session.user?.image ? (
          <img
            src={session.user.image}
            alt=""
            className="w-7 h-7 rounded-full ring-2 ring-[var(--border)]"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center text-[10px] font-bold ring-2 ring-[var(--border)]">
            {initials}
          </div>
        )}
        <span className="text-xs font-medium hidden sm:inline">{name}</span>
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-[var(--muted)]">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-[var(--border)] bg-[var(--bg)] py-1 z-50"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <button
            onClick={() => { setOpen(false); router.push("/settings/integrations"); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-hover)] transition-colors cursor-pointer flex items-center gap-2"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Integrations
          </button>
          <button
            onClick={() => { setOpen(false); router.push("/settings/api-keys"); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-hover)] transition-colors cursor-pointer flex items-center gap-2"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            API Keys
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          <button
            onClick={() => { setOpen(false); signOut({ callbackUrl: "/" }); }}
            className="w-full text-left px-3 py-2 text-sm text-[var(--muted)] hover:text-red-500 hover:bg-[var(--surface-hover)] transition-colors cursor-pointer flex items-center gap-2"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
