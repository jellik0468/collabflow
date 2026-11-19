import { useProjectSync } from "./use-project-sync";
import { ProjectTasks } from "./tasks";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Archive, FolderKanban, Plus } from "lucide-react";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";

type Project = { id: string; name: string; description: string; archivedAt: string | null };
type Workspace = { id: string; name: string; role: "OWNER" | "MEMBER" };

async function projectRequest<T>(workspaceId: string, path = "", options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspaces/${workspaceId}/projects${path}`, { cache: "no-store", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "Could not load projects. Try again.");
  return data;
}

export function WorkspaceProjects({ workspace }: { workspace: Workspace }) {
  const location = useLocation();
  const navigate = useNavigate();
  const basePath = `/app/workspaces/${workspace.id}/projects`;
  const projectId = matchPath(`${basePath}/:projectId`, location.pathname)?.params.projectId;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const refreshProject = useCallback(() => setAttempt(value => value + 1), []);
  useProjectSync(workspace.id, projectId ?? "", refreshProject);
  const canManage = workspace.role === "OWNER";

  useEffect(() => {
    const controller = new AbortController();
    projectRequest<{ projects: Project[] }>(workspace.id, "", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setProjects(data.projects); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt, workspace.id]);

  async function save(name: string, description: string, id?: string) {
    const { project } = await projectRequest<{ project: Project }>(workspace.id, id ? `/${id}` : "", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    setProjects(current => id ? (current ?? []).map(item => item.id === id ? project : item) : [project, ...(current ?? [])]);
    setMessage(id ? "Project updated." : "Project created.");
    if (!id) navigate(`${basePath}/${project.id}`);
  }

  async function archive(project: Project) {
    const { project: archived } = await projectRequest<{ project: Project }>(workspace.id, `/${project.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    setProjects(current => (current ?? []).map(item => item.id === archived.id ? archived : item));
    setMessage("Project archived.");
    navigate(basePath);
  }

  if (failed) return <section className="panel workspace-empty">
    <p role="alert">Could not load projects.</p>
    <button className="primary-button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try again</button>
  </section>;
  if (!projects) return <p role="status">Loading projects…</p>;

  const project = projects.find(item => item.id === projectId);
  const active = projects.filter(item => !item.archivedAt);
  const archived = projects.filter(item => item.archivedAt);
  return <>
    {message && <p className="project-feedback" role="status">{message}</p>}
    {projectId ? project
      ? <ProjectDetails key={project.id} project={project} workspaceId={workspace.id} basePath={basePath} canManage={canManage} onSave={save} onArchive={archive} />
      : <section className="panel workspace-empty"><h1>Project unavailable</h1><Link to={basePath}>Back to projects</Link></section>
      : <ProjectCollection key={location.pathname} title={location.pathname === "/app" ? workspace.name : "Projects"}
          basePath={basePath} active={active} archived={archived} canManage={canManage} onSave={save} />}
  </>;
}

type SaveProject = (name: string, description: string, id?: string) => Promise<void>;

function ProjectCollection({ title, basePath, active, archived, canManage, onSave }: {
  title: string; basePath: string; active: Project[]; archived: Project[]; canManage: boolean; onSave: SaveProject;
}) {
  const [creating, setCreating] = useState(false);
  return <section className="panel workspace-empty project-collection">
    <div className="project-page-heading">
      <h1>{title}</h1>
      {canManage && !creating && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> New project</button>}
    </div>
    {creating && <ProjectForm onCancel={() => setCreating(false)} onSave={async (name, description) => {
      await onSave(name, description);
      setCreating(false);
    }} />}
    {active.length > 0
      ? <ul className="project-collection-list">{active.map(project => <ProjectEntry key={project.id} project={project} basePath={basePath} />)}</ul>
      : <p>{archived.length ? "No active projects in this workspace." : "No projects in this workspace yet."}</p>}
    {archived.length > 0 && <details className="project-archive">
      <summary>Archived projects ({archived.length})</summary>
      <ul className="project-collection-list">{archived.map(project => <ProjectEntry key={project.id} project={project} basePath={basePath} />)}</ul>
    </details>}
  </section>;
}

function ProjectEntry({ project, basePath }: { project: Project; basePath: string }) {
  return <li><Link to={`${basePath}/${project.id}`}>
    <FolderKanban size={18} aria-hidden="true" />
    <span><strong>{project.name}</strong>{project.description && <small>{project.description}</small>}</span>
  </Link></li>;
}

function ProjectDetails({ project, workspaceId, basePath, canManage, onSave, onArchive }: {
  project: Project; workspaceId: string; basePath: string; canManage: boolean; onSave: SaveProject; onArchive: (project: Project) => Promise<void>;
}) {
  const [mode, setMode] = useState<"edit" | "archive" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function archive() {
    setPending(true);
    setError("");
    try { await onArchive(project); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not archive the project."); }
    finally { setPending(false); }
  }

  return <><section className="panel workspace-empty project-collection">
    <Link className="project-back" to={basePath}>Back to projects</Link>
    <div className="project-page-heading"><h1>{project.name}</h1>
      {canManage && !project.archivedAt && !mode && <div className="project-actions">
        <button className="primary-button" onClick={() => setMode("edit")}>Edit project</button>
        <button className="project-secondary" onClick={() => { setError(""); setMode("archive"); }}><Archive size={16} /> Archive project</button>
      </div>}
    </div>
    {project.archivedAt && <p>Archived project</p>}
    {project.description && <p className="project-description">{project.description}</p>}
    {mode === "edit" && <ProjectForm project={project} onCancel={() => setMode(null)} onSave={async (name, description) => {
      await onSave(name, description, project.id);
      setMode(null);
    }} />}
    {mode === "archive" && <section className="project-confirm" aria-label="Confirm project archive">
      <p>Archive this project? It will move to the archived projects list.</p>
      {error && <p role="alert">{error}</p>}
      <div className="project-actions">
        <button className="primary-button" disabled={pending} onClick={archive}>{pending ? "Archiving…" : "Confirm archive"}</button>
        <button className="project-secondary" disabled={pending} onClick={() => setMode(null)}>Cancel</button>
      </div>
    </section>}
  </section>
    <ProjectTasks workspaceId={workspaceId} projectId={project.id} archived={Boolean(project.archivedAt)} canDelete={canManage} />
  </>;
}

function ProjectForm({ project, onSave, onCancel }: { project?: Project; onSave: SaveProject; onCancel: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    if (!name) { setError("Enter a project name."); return; }
    setError("");
    setPending(true);
    try { await onSave(name, String(data.get("description"))); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save the project."); }
    finally { setPending(false); }
  }

  return <form className="project-form" onSubmit={submit}>
    <label>Project name<input name="name" defaultValue={project?.name} required maxLength={100} disabled={pending} /></label>
    <label>Description <small>(optional)</small><textarea name="description" defaultValue={project?.description} maxLength={1000} rows={4} disabled={pending} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="project-actions">
      <button className="primary-button" disabled={pending}>{pending ? "Saving…" : project ? "Save changes" : "Create project"}</button>
      <button type="button" className="project-secondary" disabled={pending} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
