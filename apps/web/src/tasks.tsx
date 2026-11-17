import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

const statuses = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };
const priorities = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
type TaskFields = {
  title: string; description: string; status: keyof typeof statuses; priority: keyof typeof priorities;
  dueDate: string | null; assigneeId: string | null;
};
type Task = TaskFields & { id: string };
type Person = { id: string; name: string };
type TaskData = { tasks: Task[]; assignees: Person[] };

async function request<T>(url: string, signal?: AbortSignal, method = "GET", body?: object): Promise<T> {
  const response = await fetch(url, {
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
  const endpoint = `/api/workspaces/${workspaceId}/projects/${projectId}/tasks`;
  useEffect(() => {
    const controller = new AbortController();
    request<TaskData>(endpoint, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
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

  return <section className="panel task-section" aria-label="Project tasks">
    <div className="project-page-heading"><h2>Tasks</h2>
      {!archived && <button className="primary-button" onClick={() => setParams(taskParams(undefined, true))}><Plus size={16} /> New task</button>}
    </div>
    {notice && <p role="status">{notice}</p>}
    {tasks.length ? <ul className="task-list">{tasks.map(task => <li key={task.id}>
      <Link to={`?${taskParams(task.id)}`}>
        <strong>{task.title}</strong>
        <span>{statuses[task.status]} · {priorities[task.priority]} priority · {person(task)}</span>
        {task.dueDate && <time dateTime={task.dueDate.slice(0, 10)}>{task.dueDate.slice(0, 10)}</time>}
      </Link>
    </li>)}</ul> : <p>No tasks in this project yet.</p>}
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
        title, description: String(data.get("description")),
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
        <button className="primary-button" onClick={() => { setSaved(false); setEditing(true); }}>Edit task</button>
        {canDelete && <button className="project-secondary" onClick={() => setConfirming(true)}>Delete task</button>}
      </div>)}
    </>}
  </>;
}
