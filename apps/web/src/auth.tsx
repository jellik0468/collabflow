import { useEffect, useState, type FormEvent } from "react";
import { Command, LogOut } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

export type User = { id: string; name: string; email: string };

class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function authRequest(path: string, input?: object): Promise<User | null> {
  const response = await fetch(`/api/auth/${path}`, {
    cache: "no-store",
    ...(input && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new AuthError(data?.error ?? "The server is unavailable. Try again.", response.status);
  if (!data?.user) throw new Error("The server returned an incomplete response. Try again.");
  return data.user;
}

export function useSession() {
  const [session, setSession] = useState<User | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    authRequest("me").then(user => {
      if (active) setSession(user);
    }).catch(error => {
      if (!active) return;
      if (error instanceof AuthError && error.status === 401) setSession(null);
      else setFailed(true);
    });
    return () => { active = false; };
  }, [attempt]);
  return { session, setSession, failed, retry: () => { setFailed(false); setAttempt(attempt + 1); } };
}

export function RequireSession({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  return children ?? <Navigate to={`/login?next=${next}`} replace />;
}

export function AuthPage({ mode, user, onUser }: {
  mode: "login" | "register"; user: User | null; onUser: (user: User) => void;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const register = mode === "register";
  const next = params.get("next") ?? "";
  const destination = /^\/app(?:[/?#]|$)/.test(next) && !next.includes("\\") ? next : "/app";
  if (user) return <Navigate to={destination} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    if (register && new TextEncoder().encode(password).length > 72) {
      setError("Use a shorter password. The limit is 72 bytes.");
      return;
    }
    setPending(true);
    try {
      const result = await authRequest(mode, Object.fromEntries(data));
      if (!result) throw new Error("Your session could not be started. Try again.");
      onUser(result);
      navigate(destination, { replace: true });
    } catch (error) {
      setError(error instanceof AuthError ? error.message : "Could not connect. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <main className="auth-layout">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="brand"><div className="brand-mark"><Command size={19} /></div><span>collab<span className="brand-accent">flow</span></span></div>
      <h1 id="auth-title">{register ? "Create your account" : "Sign in to CollabFlow"}</h1>
      <form className="auth-form" onSubmit={submit}>
        {register && <label>Full name<input name="name" autoComplete="name" maxLength={80} required /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <label>Password<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 10 : undefined} maxLength={128} required />
          {register && <small>Use at least 10 characters.</small>}
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={pending}>{pending ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
      </form>
      <p className="auth-switch">{register ? "Have an account? " : "New to CollabFlow? "}
        <Link to={`/${register ? "login" : "register"}${next ? `?next=${encodeURIComponent(next)}` : ""}`}>{register ? "Sign in" : "Create an account"}</Link>
      </p>
    </section>
  </main>;
}

export function SignOut({ onSignOut }: { onSignOut: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setPending(true);
    setError(false);
    try {
      await authRequest("logout", {});
      onSignOut();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return <div>
    <button className="icon-button" aria-label="Sign out" title="Sign out" disabled={pending} onClick={signOut}><LogOut size={18} /></button>
    {error && <small role="alert">Sign-out failed. Try again.</small>}
  </div>;
}
