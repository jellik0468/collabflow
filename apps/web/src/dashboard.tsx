import { apiFetch } from "./api";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, FolderKanban, RefreshCw } from "lucide-react";

type Dashboard = {
  summary: { totalTasks: number; completedTasks: number; inProgressTasks: number; activeProjects: number; assignedOpenTasks: number; completionRate: number };
  projects: { id: string; name: string; taskCount: number; completedCount: number }[];
  assignedTasks: { id: string; title: string; status: "TODO" | "IN_PROGRESS"; priority: "LOW" | "MEDIUM" | "HIGH";
    dueDate: string | null; project: { id: string; name: string } }[];
};
const priorities = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export function WorkspaceDashboard({ workspace, myTasks = false }: {
  workspace: { id: string; name: string }; myTasks?: boolean;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setAttempt(value => value + 1); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    apiFetch(`/api/workspaces/${workspace.id}/dashboard`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Dashboard unavailable");
        return response.json() as Promise<Dashboard>;
      }).then(result => { if (!controller.signal.aborted) { setData(result); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.id, attempt]);
  const projectsPath = `/app/workspaces/${workspace.id}/projects`;
  if (!data) return <section className="panel workspace-empty">
    {failed ? <><p role="alert">Could not load your workspace dashboard.</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></>
      : <p role="status">Loading your workspace dashboard…</p>}
  </section>;
  const { summary, projects, assignedTasks } = data;
  const stats = [
    { label: "Total tasks", value: summary.totalTasks, detail: "In active projects" },
    { label: "In progress", value: summary.inProgressTasks, detail: "Currently active" },
    { label: "Completed", value: summary.completedTasks, detail: `${summary.completionRate}% completion` },
    { label: "Active projects", value: summary.activeProjects, detail: "Across this workspace" },
  ];
  return <>
    <div className="page-heading"><div><h1>{myTasks ? "My tasks" : workspace.name}</h1>
      <p>{myTasks ? "Your open tasks in this workspace." : "Your workspace at a glance."}</p></div>
      <button className="project-secondary" disabled={loading} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />{loading ? "Refreshing…" : "Refresh dashboard"}</button>
    </div>
    {!myTasks && <div className="stats">{stats.map(stat => <section className="stat-card" aria-label={stat.label} key={stat.label}>
      <span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.detail}</small>
    </section>)}</div>}
    <div className={myTasks ? "assigned-page" : "dashboard-grid"}>
      <section className="panel dashboard-section" aria-label="Assigned tasks">
        <div className="panel-heading"><h2>Assigned to you</h2><span>{summary.assignedOpenTasks} open</span></div>
        {assignedTasks.length ? <ul className="dashboard-task-list">{assignedTasks.map(task => <li key={task.id}>
          <Link to={`${projectsPath}/${task.project.id}?task=${task.id}`}>
            <span><strong>{task.title}</strong><small>{task.project.name} · {task.status === "TODO" ? "To do" : "In progress"}
              {task.dueDate && ` · Due ${task.dueDate.slice(0, 10)}`}</small></span>
            <span className={`priority ${task.priority.toLowerCase()}`}>{priorities[task.priority]}</span>
          </Link>
        </li>)}</ul> : <p>No open tasks assigned to you.</p>}
        {summary.assignedOpenTasks > assignedTasks.length && <p className="dashboard-caption">Showing the first 10 open tasks, ordered by due date.</p>}
      </section>
      {!myTasks && <section className="panel dashboard-section" aria-label="Active project list">
        <div className="panel-heading"><h2>Active projects</h2><Link to={projectsPath}>View all <ArrowUpRight size={13} /></Link></div>
        {projects.length ? <ul className="dashboard-task-list">{projects.map(project => <li key={project.id}>
          <Link to={`${projectsPath}/${project.id}`}>
            <FolderKanban size={18} /><span><strong>{project.name}</strong><small>{project.completedCount} of {project.taskCount} tasks completed</small></span>
          </Link>
          <progress className="dashboard-progress" value={project.completedCount} max={project.taskCount || 1} aria-label={`Completion for ${project.name}`} />
        </li>)}</ul> : <><p>No projects in this workspace yet.</p><Link className="project-back" to={projectsPath}>Open projects</Link></>}
        {summary.activeProjects > projects.length && <p className="dashboard-caption">Showing the 8 most recently updated projects.</p>}
      </section>}
    </div>
  </>;
}
