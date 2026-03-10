"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export default function AccountPage() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="py-12">
        <span className="text-sm text-[var(--muted)]">Loading...</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="py-12">
        <h1 className="text-xl font-semibold mb-1">Account</h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          Sign in to manage your account settings.
        </p>
        <button
          onClick={() => signIn("google")}
          className="px-4 py-2.5 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-85 transition-all cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const name = session.user?.name || "";
  const email = session.user?.email || "";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Account</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Manage your personal account settings.
      </p>

      {/* User info card */}
      <div className="flex items-center gap-4 p-5 rounded-xl border border-[var(--border)] mb-8">
        {session.user?.image ? (
          <img
            src={session.user.image}
            alt=""
            className="w-12 h-12 rounded-full ring-2 ring-[var(--border)]"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center text-sm font-bold ring-2 ring-[var(--border)]">
            {initials}
          </div>
        )}
        <div>
          {name && (
            <p className="text-sm font-medium">{name}</p>
          )}
          {email && (
            <p className="text-sm text-[var(--muted)]">{email}</p>
          )}
        </div>
      </div>

      {/* Sign out */}
      <div>
        <h2 className="text-sm font-medium mb-2 text-[var(--muted)]">
          Session
        </h2>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--muted)] hover:text-red-500 hover:border-red-300 transition-colors cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
