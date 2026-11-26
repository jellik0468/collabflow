import { apiFetch } from "./api";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { User } from "./auth";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, { cache: "no-store", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "The request failed. Please try again.");
  return data;
}

export function WorkspaceMembers({ workspace }: { workspace: { id: string; name: string; role: "OWNER" | "MEMBER" } }) {
  const [members, setMembers] = useState<(User & { role: string })[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<{ members: (User & { role: string })[] }>(`/api/workspaces/${workspace.id}/members`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setMembers(data.members); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [workspace.id, attempt]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email"));
    setPending(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/workspaces/${workspace.id}/invitations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      form.reset();
      setNotice("Invitation sent.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not send invitation."); }
    finally { setPending(false); }
  }
  return <section className="panel workspace-empty">
    <h1>Members</h1><p>{workspace.name}</p>
    {failed ? <><p role="alert">Could not load members.</p><button className="project-secondary" onClick={() => setAttempt(value => value + 1)}>Retry members</button></>
      : !members ? <p role="status">Loading members…</p>
        : <ul className="member-list">{members.map(member => <li key={member.id}>
          <span><strong>{member.name}</strong><small>{member.email}</small></span><span>{member.role === "OWNER" ? "Owner" : "Member"}</span>
        </li>)}</ul>}
    {workspace.role === "OWNER" && <form className="project-form" onSubmit={invite}>
      <h2>Invite a teammate</h2>
      <label>Email address<input type="email" name="email" required maxLength={254} disabled={pending} /></label>
      <p>Invited teammates join as members. Invitations expire after seven days.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="primary-button" disabled={pending}>{pending ? "Sending…" : "Send invitation"}</button>
    </form>}
  </section>;
}

export function AcceptInvitation({ user }: { user: User | null }) {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<{ id: string; name: string } | null>(null);
  const next = encodeURIComponent("/invite" + location.hash);
  async function accept() {
    setPending(true);
    setError("");
    try {
      const data = await api<{ workspace: { id: string; name: string } }>("/api/invitations/accept", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (user) localStorage.setItem(`collabflow-workspace:${user.id}`, data.workspace.id);
      setJoined(data.workspace);
      window.history.replaceState(null, "", "/invite");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not accept invitation."); }
    finally { setPending(false); }
  }
  return <main className="auth-layout"><section className="auth-card">
    <h1>{joined ? "Workspace joined" : "Workspace invitation"}</h1>
    {joined ? <><p>You joined {joined.name}.</p><Link className="primary-button" to="/app">Open workspace</Link></>
      : !/^[A-Za-z0-9_-]{43}$/.test(token) ? <><p role="alert">This invitation link is incomplete.</p><Link to="/app">Open CollabFlow</Link></>
      : user ? <>
        <p>Signed in as {user.email}. Use the account matching the invitation email.</p>
        {error && <p role="alert">{error}</p>}
        <button className="primary-button" disabled={pending} onClick={accept}>{pending ? "Joining…" : "Accept invitation"}</button>
      </> : <>
        <p>Sign in or create an account with the email address that received this invitation.</p>
        <div className="project-actions"><Link className="primary-button" to={`/login?next=${next}`}>Sign in</Link>
          <Link className="project-back" to={`/register?next=${next}`}>Create an account</Link></div>
      </>}
  </section></main>;
}
