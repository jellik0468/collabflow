import { apiFetch } from "./api";
import { useEffect, useState, type FormEvent } from "react";

type Workspace = { id: string; name: string; role: "OWNER" | "MEMBER" };

async function workspaceRequest(path = "", options?: RequestInit) {
  const response = await apiFetch(`/api/workspaces${path}`, { cache: "no-store", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error ?? "Workspaces are unavailable. Try again.");
  }
  return data;
}

export function useWorkspaces(userId: string) {
  const key = `collabflow-workspace:${userId}`;
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(key) ?? "");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    workspaceRequest("", { signal: controller.signal })
      .then((data: { workspaces: Workspace[] }) => {
        if (!controller.signal.aborted) setWorkspaces(data.workspaces);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  function selectWorkspace(id: string) {
    setSelectedId(id);
    localStorage.setItem(key, id);
  }

  async function saveWorkspace(name: string, id?: string) {
    const { workspace }: { workspace: Workspace } = await workspaceRequest(id ? `/${id}` : "", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setWorkspaces(current => id
      ? current.map(item => item.id === id ? workspace : item)
      : [...current, workspace]);
    if (!id) selectWorkspace(workspace.id);
  }

  return {
    workspaces,
    active: workspaces.find(item => item.id === selectedId) ?? workspaces.at(0),
    loading,
    error,
    retry: () => { setError(false); setLoading(true); setAttempt(value => value + 1); },
    selectWorkspace,
    saveWorkspace,
  };
}

export function WorkspaceSwitcher({ state, onSwitch, createRequest = 0 }: {
  createRequest?: number;
  state: ReturnType<typeof useWorkspaces>;
  onSwitch: () => void;
}) {
  const [mode, setMode] = useState<"create" | "rename" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const { active } = state;
  useEffect(() => {
    if (createRequest) { setMode("create"); setError(""); setStatus(""); }
  }, [createRequest]);
  if (state.loading) return <p className="workspace-status" role="status">Loading workspaces…</p>;
  if (state.error) return <div className="workspace-status">
    <p role="alert">Could not load workspaces.</p>
    <button type="button" onClick={state.retry}>Try again</button>
  </div>;

  function openForm(next: typeof mode) {
    setMode(next);
    setError("");
    setStatus("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (!name) {
      setError("Enter a workspace name.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await state.saveWorkspace(name, mode === "rename" ? active?.id : undefined);
      setMode(null);
      setStatus(mode === "create" ? "Workspace created." : "Workspace renamed.");
      if (mode === "create") onSwitch();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the workspace.");
    } finally {
      setPending(false);
    }
  }

  return <section className="workspace-control" aria-label="Workspace management">
    <label htmlFor="workspace-switcher">Workspace</label>
    <select id="workspace-switcher" value={active?.id ?? ""} disabled={pending} onChange={event => {
      state.selectWorkspace(event.target.value);
      openForm(null);
      onSwitch();
    }}>
      <option value="" disabled>Choose a workspace</option>
      {state.workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select>
    <div className="workspace-actions">
      <button type="button" disabled={pending} onClick={() => openForm("create")}>New workspace</button>
      {active?.role === "OWNER" && <button type="button" disabled={pending} onClick={() => openForm("rename")}>Rename</button>}
    </div>
    {mode && <form className="workspace-form" key={mode} onSubmit={submit}>
      <label htmlFor="workspace-name">Workspace name</label>
      <input id="workspace-name" name="name" autoFocus defaultValue={mode === "rename" ? active?.name : ""} maxLength={80} required disabled={pending} />
      {error && <p role="alert">{error}</p>}
      <div className="workspace-actions">
        <button className="primary-button" disabled={pending}>{pending ? "Saving…" : mode === "create" ? "Create workspace" : "Save name"}</button>
        <button type="button" disabled={pending} onClick={() => openForm(null)}>Cancel</button>
      </div>
    </form>}
    {status && <p role="status">{status}</p>}
  </section>;
}
