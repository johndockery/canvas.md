"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

interface TeamMember {
  member_email: string;
  role: string;
  joined_at: string;
}

interface TeamInvite {
  id: string;
  invite_email: string;
  role: string;
  created_at: string;
}

export default function TeamPage() {
  const { data: session } = useSession();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerEmail = session?.user?.email || "";
  const ownerName = session?.user?.name || "";

  const fetchTeam = useCallback(async () => {
    try {
      const res = await fetch("/api/canvas/team");
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setInvites(data.invites || []);
      }
    } catch (err) {
      console.error("Failed to load team:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  async function sendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;

    setInviting(true);
    setError(null);
    try {
      const res = await fetch("/api/canvas/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "editor" }),
      });
      if (res.ok) {
        setInviteEmail("");
        fetchTeam();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to invite");
      }
    } catch {
      setError("Failed to invite");
    } finally {
      setInviting(false);
    }
  }

  async function cancelInvite(id: string) {
    try {
      await fetch(`/api/canvas/team/invite/${id}`, { method: "DELETE" });
      fetchTeam();
    } catch (err) {
      console.error("Failed to cancel invite:", err);
    }
  }

  async function removeMember(email: string) {
    try {
      await fetch(`/api/canvas/team/member/${encodeURIComponent(email)}`, { method: "DELETE" });
      fetchTeam();
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  }

  const initials = (str: string) =>
    str.includes("@")
      ? str[0].toUpperCase()
      : str.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1">Team</h1>
        <p className="text-sm text-[var(--muted)]">
          Manage who has access to your workspace and documents.
        </p>
      </div>

      {/* Invite form */}
      <div className="flex items-center gap-2 mb-8">
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => { setInviteEmail(e.target.value); setError(null); }}
          placeholder="Email address"
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm outline-none focus:border-[var(--muted)] transition-colors"
          onKeyDown={(e) => { if (e.key === "Enter") sendInvite(); }}
        />
        <button
          onClick={sendInvite}
          disabled={inviting || !inviteEmail.trim()}
          className="px-4 py-2 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium hover:opacity-85 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {inviting ? "Inviting..." : "Invite"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 -mt-6 mb-4">{error}</p>}

      {/* Table header */}
      <div className="flex items-center py-2 border-b border-[var(--border)] mb-0">
        <span
          className="flex-1 text-[11px] font-semibold uppercase text-[var(--muted)]"
          style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
        >
          Member
        </span>
        <span
          className="w-24 text-right text-[11px] font-semibold uppercase text-[var(--muted)] mr-12"
          style={{ fontFamily: "var(--font-section)", letterSpacing: "0.08em" }}
        >
          Role
        </span>
      </div>

      {/* Owner */}
      <div className="flex items-center py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center text-[11px] font-bold shrink-0">
            {initials(ownerName || ownerEmail)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {ownerName && <span className="text-sm font-medium">{ownerName}</span>}
              <span className="text-[10px] font-medium text-[var(--muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded">you</span>
            </div>
            <p className="text-xs text-[var(--muted)]">{ownerEmail}</p>
          </div>
        </div>
        <span className="w-24 text-right mr-12">
          <span className="text-xs font-medium text-[var(--fg)] bg-[var(--surface)] px-2 py-0.5 rounded-full">
            Owner
          </span>
        </span>
      </div>

      {/* Members */}
      {members.map((m) => (
        <div key={m.member_email} className="flex items-center py-3 border-b border-[var(--border)] group">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[var(--surface)] text-[var(--muted)] flex items-center justify-center text-[11px] font-bold shrink-0">
              {initials(m.member_email)}
            </div>
            <div className="min-w-0">
              <p className="text-sm">{m.member_email}</p>
            </div>
          </div>
          <span className="w-24 text-right text-sm text-[var(--muted)] capitalize mr-4">{m.role}</span>
          <button
            onClick={() => removeMember(m.member_email)}
            className="text-xs text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer w-8"
          >
            Remove
          </button>
        </div>
      ))}

      {/* Pending invites */}
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center py-3 border-b border-[var(--border)] group">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full border border-dashed border-[var(--border)] text-[var(--muted)] flex items-center justify-center text-[11px] shrink-0">
              {initials(inv.invite_email)}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-[var(--muted)]">{inv.invite_email}</p>
            </div>
          </div>
          <span className="w-24 text-right mr-4">
            <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              Pending
            </span>
          </span>
          <button
            onClick={() => cancelInvite(inv.id)}
            className="text-xs text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer w-8"
          >
            Cancel
          </button>
        </div>
      ))}

      {loading && <p className="text-sm text-[var(--muted)] py-4">Loading...</p>}

      {!loading && members.length === 0 && invites.length === 0 && (
        <p className="text-sm text-[var(--muted)] mt-4">
          Invite teammates by email. They&#39;ll get access when they sign in.
        </p>
      )}
    </div>
  );
}
