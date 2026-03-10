"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const navItems = [
  { label: "Account", href: "/settings" },
  { label: "Team", href: "/settings/team" },
  { label: "Integrations", href: "/settings/integrations" },
  { label: "API Keys", href: "/settings/api-keys" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const name = session?.user?.name || "";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      {/* Header */}
      <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-sm" style={{ fontFamily: "var(--font-section)" }}>
          <Link
            href="/"
            className="font-semibold hover:opacity-80 transition-opacity"
          >
            Canvas
          </Link>
          <span className="text-[var(--muted)]">&gt;</span>
          <span className="font-medium text-[var(--muted)]">Settings</span>
        </div>
        <div className="flex items-center">
          {session?.user?.image ? (
            <img
              src={session.user.image}
              alt=""
              className="w-8 h-8 rounded-full ring-2 ring-[var(--border)]"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center text-[11px] font-bold ring-2 ring-[var(--border)]">
              {initials || "?"}
            </div>
          )}
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <nav className="w-[180px] shrink-0 border-r border-[var(--border)] pt-8 px-3">
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const isActive =
                item.href === "/settings"
                  ? pathname === "/settings"
                  : pathname.startsWith(item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-3 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? "bg-[var(--surface)] font-semibold text-[var(--fg)]"
                        : "text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]"
                    }`}
                    style={{ fontSize: "14px" }}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[900px] px-10 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
