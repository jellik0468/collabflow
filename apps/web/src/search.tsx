import { apiFetch } from "./api";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

type Workspace = { id: string; name: string };
type Results = {
  projects: { id: string; name: string; description: string }[];
  tasks: { id: string; title: string; status: string; project: { id: string; name: string } }[];
  moreProjects: boolean; moreTasks: boolean;
};
const statuses: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };

function SearchForm({ initialQuery = "", onSearch }: { initialQuery?: string; onSearch: (query: string) => void }) {
  return <form className="workspace-search-form" role="search" onSubmit={(event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q")).trim();
    if (query.length >= 2 && query.length <= 100) onSearch(query);
  }}>
    <label>Search projects and tasks<input autoFocus name="q" type="search" minLength={2} maxLength={100} required defaultValue={initialQuery} /></label>
    <button className="primary-button">Search</button>
  </form>;
}

export function WorkspaceSearchButton({ workspace }: { workspace: Workspace }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        dialog.current?.showModal();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  return <>
    <button className="icon-button" aria-label="Search workspace" title="Search workspace (Ctrl+K)" onClick={() => dialog.current?.showModal()}><Search size={19} /></button>
    <dialog ref={dialog} className="workspace-search-dialog" aria-labelledby="workspace-search-title">
      <div className="project-page-heading"><h2 id="workspace-search-title">Search {workspace.name}</h2>
        <button className="icon-button" aria-label="Close search" onClick={() => dialog.current?.close()}><X size={19} /></button></div>
      <SearchForm onSearch={query => {
        dialog.current?.close();
        navigate(`/app/workspaces/${workspace.id}/search?q=${encodeURIComponent(query)}`);
      }} />
    </dialog>
  </>;
}

export function WorkspaceSearch({ workspace }: { workspace: Workspace }) {
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const valid = query.length >= 2 && query.length <= 100;
  const [data, setData] = useState<Results | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    if (valid) apiFetch(`/api/workspaces/${workspace.id}/search?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Search failed"); return response.json() as Promise<Results>; })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [workspace.id, query, valid, attempt]);
  const projectsPath = `/app/workspaces/${workspace.id}/projects`;
  return <section className="panel workspace-empty search-results">
    <h1>Search</h1><p>Find projects and tasks in {workspace.name}. Archived projects are excluded.</p>
    <SearchForm key={query} initialQuery={query} onSearch={q => setParams({ q })} />
    {!valid ? <p>Enter between 2 and 100 characters to search.</p>
      : failed ? <><p role="alert">Could not search this workspace.</p><button className="project-secondary" onClick={() => setAttempt(value => value + 1)}>Try again</button></>
        : !data ? <p role="status">Searching…</p> : <>
          <p role="status">{data.projects.length + data.tasks.length ? `Results for “${query}”` : `No results for “${query}”.`}</p>
          {data.projects.length > 0 && <section className="search-result-group" aria-label="Project search results"><h2>Projects</h2>
            <ul className="project-collection-list">{data.projects.map(project => <li key={project.id}><Link to={`${projectsPath}/${project.id}`}>
              <span><strong>{project.name}</strong>{project.description && <small>{project.description}</small>}</span>
            </Link></li>)}</ul>
            {data.moreProjects && <p>Showing the first 10 projects. Refine your search for more specific results.</p>}
          </section>}
          {data.tasks.length > 0 && <section className="search-result-group" aria-label="Task search results"><h2>Tasks</h2>
            <ul className="project-collection-list">{data.tasks.map(task => <li key={task.id}><Link to={`${projectsPath}/${task.project.id}?task=${task.id}`}>
              <span><strong>{task.title}</strong><small>{task.project.name} · {statuses[task.status]}</small></span>
            </Link></li>)}</ul>
            {data.moreTasks && <p>Showing the first 25 tasks. Refine your search for more specific results.</p>}
          </section>}
        </>}
  </section>;
}
