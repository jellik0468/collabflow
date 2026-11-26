import { apiFetch } from "./api";
import { TaskComments } from "./comments";
import { useProjectSync } from "./use-project-sync";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

const statuses = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };
type TaskStatus = keyof typeof statuses;
const lanes = Object.entries(statuses) as [TaskStatus, string][];
const priorities = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
type TaskFields = {
  title: string; description: string; status: TaskStatus; priority: keyof typeof priorities;
  dueDate: string | null; assigneeId: string | null; expectedVersion?: number;
};
type Task = TaskFields & { id: string; version: number };
type Person = { id: string; name: string };
type TaskData = { tasks: Task[]; assignees: Person[] };

async function request<T>(url: string, signal?: AbortSignal, method = "GET", body?: object): Promise<T> {
  const response = await apiFetch(url, {
    cache: "no-store", signal, method,
    ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "Could not load or save tasks. Try again.");
  return data;
}

export function ProjectTasks({ workspaceId, projectId, archived, canDelete }: {
  workspaceId: string; projectId: string; archived: boolean; canDelete: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("task");
  const creating = params.get("newTask") === "1" && !archived && !selected;
  const [data, setData] = useState<TaskData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const [moveError, setMoveError] = useState("");
  const pendingMoves = useRef(new Set<string>());
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<TaskStatus | null>(null);
  const view = params.get("view") === "overview" ? "overview" : params.get("view") === "list" ? "list" : "board";
  const listView = view === "list";
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const connected = useProjectSync(workspaceId, projectId, refresh);
  const endpoint = `/api/workspaces/${workspaceId}/projects/${projectId}/tasks`;
  useEffect(() => {
    const controller = new AbortController();
    request<TaskData>(endpoint, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [endpoint, attempt]);

  function taskParams(id?: string, newTask = false) {
    const next = new URLSearchParams(params);
    next.delete("task");
    next.delete("newTask");
    if (id) next.set("task", id);
    if (newTask) next.set("newTask", "1");
    return next;
  }
  function close() { setParams(taskParams(), { replace: true }); }

  if (failed) return <section className="panel task-section">
    <p role="alert">Could not load project tasks.</p>
    <button className="primary-button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try again</button>
  </section>;
  if (!data) return <p role="status">Loading tasks…</p>;
  const { tasks, assignees } = data;
  const active = tasks.find(task => task.id === selected);
  const person = (task: Task) => assignees.find(item => item.id === task.assigneeId)?.name ?? "Unassigned";

  async function save(fields: TaskFields) {
    const { task } = await request<{ task: Task }>(active ? `${endpoint}/${active.id}` : endpoint,
      undefined, active ? "PATCH" : "POST", fields);
    setData(current => current && ({ ...current, tasks: active
      ? current.tasks.map(item => item.id === task.id ? task : item)
      : [...current.tasks, task] }));
    setNotice(active ? "Task updated." : "Task created.");
    return task.id;
  }
  async function remove(id: string) {
    const taskUrl = window.location.href;
    await request<void>(`${endpoint}/${id}`, undefined, "DELETE", {});
    setData(current => current && ({ ...current, tasks: current.tasks.filter(item => item.id !== id) }));
    setNotice("Task deleted.");
    if (window.location.href === taskUrl) close();
  }

  async function moveTask(id: string, status: TaskStatus, control?: HTMLSelectElement) {
    const current = tasks.find(task => task.id === id);
    if (!current || current.status === status || archived || pendingMoves.current.has(id)) return;
    pendingMoves.current.add(id);
    const restoreFocus = control && document.activeElement === control;
    setMoving(previous => new Set(previous).add(id));
    setNotice("");
    setMoveError("");
    try {
      const { task } = await request<{ task: Task }>(`${endpoint}/${id}/status`, undefined, "PATCH", { status });
      setData(previous => previous && ({ ...previous, tasks: previous.tasks.map(item => item.id === id ? { ...item, status: task.status, version: task.version } : item) }));
      setNotice(`${task.title} moved to ${statuses[task.status]}.`);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Could not move task. Try again.");
    } finally {
      pendingMoves.current.delete(id);
      setMoving(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      if (restoreFocus) requestAnimationFrame(() => {
        if (document.activeElement === document.body) document.getElementById(`task-status-${id}`)?.focus();
      });
    }
  }

  function changeView(nextView: "board" | "list" | "overview") {
    const next = new URLSearchParams(params);
    if (nextView !== "board") next.set("view", nextView);
    else next.delete("view");
    setParams(next);
  }

  function endDrag() {
    setDragging(null);
    setDropLane(null);
  }

  function taskCard(task: Task, draggable: boolean) {
    return <li key={task.id} className="board-card" data-dragging={dragging === task.id}>
      <Link to={`?${taskParams(task.id)}`} draggable={draggable && !archived && !moving.has(task.id)}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
          setDragging(task.id);
        }} onDragEnd={endDrag}>
        <strong>{task.title}</strong>
        <span>{listView && `${statuses[task.status]} · `}{priorities[task.priority]} priority · {person(task)}</span>
        {task.dueDate && <time dateTime={task.dueDate.slice(0, 10)}>{task.dueDate.slice(0, 10)}</time>}
      </Link>
      {!archived && <label className="board-card-status">Status
        <select id={`task-status-${task.id}`} aria-label={`Status for ${task.title}`} value={task.status} disabled={moving.has(task.id)}
          onChange={event => void moveTask(task.id, event.target.value as TaskStatus, event.currentTarget)}>
          {lanes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>}
    </li>;
  }

  return <section className="panel task-section" aria-label="Project tasks">
    <div className="project-page-heading"><h2>Tasks</h2>
      {!archived && <button className="primary-button" onClick={() => setParams(taskParams(undefined, true))}><Plus size={16} /> New task</button>}
    </div>
    <div className="board-view-switch" role="group" aria-label="Task view">
      <button type="button" aria-pressed={view === "board"} onClick={() => changeView("board")}>Board</button>
      <button type="button" aria-pressed={listView} onClick={() => changeView("list")}>List</button>
      <button type="button" aria-pressed={view === "overview"} onClick={() => changeView("overview")}>Overview</button>
    </div>
    <p className="sync-status" role="status">{connected ? "Live updates connected" : "Live updates disconnected. Reconnecting…"}</p>
    {notice && <p role="status">{notice}</p>}
    {moveError && <p role="alert">{moveError}</p>}
    {!tasks.length && <p>No tasks in this project yet.</p>}
    {view === "overview" ? <section className="project-overview" aria-label="Project overview">
      <div className="stats">
        {[{ label: "Total tasks", value: tasks.length },
          ...lanes.map(([status, label]) => ({ label, value: tasks.filter(task => task.status === status).length }))].map(stat =>
          <section className="stat-card" key={stat.label} aria-label={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></section>)}
      </div>
      <p>{tasks.length ? Math.round(tasks.filter(task => task.status === "DONE").length / tasks.length * 100) : 0}% complete</p>
      <progress className="dashboard-progress" value={tasks.filter(task => task.status === "DONE").length} max={tasks.length || 1} aria-label="Project completion" />
    </section> : listView ? <ul className="task-list board-card-list">{tasks.map(task => taskCard(task, false))}</ul>
      : <div className="project-board" aria-label="Kanban board">
        {lanes.map(([status, label]) => {
          const laneTasks = tasks.filter(task => task.status === status);
          return <section key={status} className="board-lane" aria-label={`${label} column`}
            data-drop-active={dropLane === status}
            onDragOver={event => {
              if (!dragging || archived) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropLane(status);
            }}
            onDragLeave={event => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                setDropLane(current => current === status ? null : current);
              }
            }}
            onDrop={event => {
              if (!dragging || archived) return;
              event.preventDefault();
              const id = event.dataTransfer.getData("text/plain");
              if (id === dragging) void moveTask(id, status);
              endDrag();
            }}>
            <div className="board-lane-heading"><h3>{label}</h3><span aria-label={`${laneTasks.length} tasks`}>{laneTasks.length}</span></div>
            {laneTasks.length ? <ul className="task-list board-card-list">{laneTasks.map(task => taskCard(task, true))}</ul> : <p className="board-empty">No tasks</p>}
          </section>;
        })}
      </div>}
    {(creating || selected) && <TaskPanel key={active?.id ?? selected ?? "new"}
      title={active?.title ?? (creating ? "New task" : "Task unavailable")} onClose={close}>
      {active || creating
        ? <TaskDetails task={active} assignees={assignees} assignee={active ? person(active) : ""} archived={archived}
            canDelete={canDelete} onSave={async fields => {
              const taskUrl = window.location.href;
              const id = await save(fields);
              if (creating && window.location.href === taskUrl) setParams(taskParams(id), { replace: true });
            }} onDelete={remove} />
        : <p>This task could not be found in the project.</p>}
      {active && <TaskComments key={active.id} workspaceId={workspaceId} projectId={projectId} taskId={active.id} archived={archived} />}
    </TaskPanel>}
  </section>;
}

function TaskPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="task-dialog" aria-labelledby="real-task-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="task-dialog-header">
      <h2 id="real-task-title">{title}</h2>
      <button className="icon-button" aria-label="Close task panel" onClick={onClose}><X size={20} /></button>
    </div>
    <div className="task-dialog-body">{children}</div>
  </dialog>;
}

function TaskDetails({ task, assignees, assignee, archived, canDelete, onSave, onDelete }: {
  task?: Task; assignees: Person[]; assignee: string; archived: boolean; canDelete: boolean;
  onSave: (fields: TaskFields) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(!task);
  const [editingVersion, setEditingVersion] = useState(task?.version);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title")).trim();
    if (!title) { setError("Enter a task title."); return; }
    setPending(true);
    setError("");
    try {
      await onSave({
        title, description: String(data.get("description")), expectedVersion: editingVersion,
        status: data.get("status") as TaskFields["status"], priority: data.get("priority") as TaskFields["priority"],
        assigneeId: String(data.get("assigneeId")) || null, dueDate: String(data.get("dueDate")) || null,
      });
      setEditing(false);
      setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the task."); }
    finally { setPending(false); }
  }
  async function remove(id: string) {
    setPending(true);
    setError("");
    try { await onDelete(id); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not delete the task."); }
    finally { setPending(false); }
  }

  return <>
    {error && <p className="task-message" role="alert">{error}</p>}
    {editing ? <form className="project-form task-form" onSubmit={save}>
      <label>Task title<input name="title" required maxLength={120} defaultValue={task?.title} disabled={pending} /></label>
      <label>Description<textarea name="description" rows={4} maxLength={2000} defaultValue={task?.description} disabled={pending} /></label>
      <label>Status<select name="status" defaultValue={task?.status ?? "TODO"} disabled={pending}>
        {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Priority<select name="priority" defaultValue={task?.priority ?? "MEDIUM"} disabled={pending}>
        {Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Assignee<select name="assigneeId" defaultValue={assignees.some(item => item.id === task?.assigneeId) ? task?.assigneeId ?? "" : ""} disabled={pending}>
        <option value="">Unassigned</option>
        {assignees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Due date<input name="dueDate" type="date" min="0001-01-01" max="9999-12-31" defaultValue={task?.dueDate?.slice(0, 10)} disabled={pending} /></label>
      <div className="project-actions">
        <button className="primary-button" disabled={pending}>{pending ? "Saving…" : task ? "Save task" : "Create task"}</button>
        {task && <button type="button" className="project-secondary" disabled={pending} onClick={() => { setEditing(false); setError(""); }}>Cancel</button>}
      </div>
    </form> : task && <>
      {saved && <p role="status">Task saved.</p>}
      {task.description && <p className="project-description">{task.description}</p>}
      <dl className="task-metadata">
        <dt>Status</dt><dd>{statuses[task.status]}</dd>
        <dt>Priority</dt><dd>{priorities[task.priority]}</dd>
        <dt>Assignee</dt><dd>{assignee}</dd>
        <dt>Due date</dt><dd>{task.dueDate?.slice(0, 10) ?? "No due date"}</dd>
      </dl>
      {!archived && (confirming ? <div className="project-confirm">
        <p>Permanently delete this task?</p>
        <div className="project-actions">
          <button className="primary-button" disabled={pending} onClick={() => remove(task.id)}>Confirm delete</button>
          <button className="project-secondary" disabled={pending} onClick={() => { setConfirming(false); setError(""); }}>Cancel</button>
        </div>
      </div> : <div className="project-actions">
        <button className="primary-button" onClick={() => { setSaved(false); setEditingVersion(task.version); setEditing(true); }}>Edit task</button>
        {canDelete && <button className="project-secondary" onClick={() => setConfirming(true)}>Delete task</button>}
      </div>)}
    </>}
  </>;
}
