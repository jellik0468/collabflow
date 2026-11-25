import { WorkspaceSearch, WorkspaceSearchButton } from "./search";
import { useNotifications, NotificationBell, NotificationInbox } from "./notifications";
import { AcceptInvitation, WorkspaceMembers } from "./invitations";
import { WorkspaceDashboard } from "./dashboard";
import { WorkspaceProjects } from "./projects";
import { useWorkspaces, WorkspaceSwitcher } from "./workspaces";
import { AuthPage, RequireSession, SignOut, useSession, type User } from "./auth";
import { useEffect, useRef, useState } from "react";
import { Link, matchPath, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Command, FolderKanban, LayoutDashboard, ListTodo, Menu, Moon, Plus, Settings, Sun, Users, X } from "lucide-react";

function AppShell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const initials = user.name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  const workspaces = useWorkspaces(user.id);
  const inbox = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const workspaceRoute = matchPath("/app/workspaces/:workspaceId/*", location.pathname);
  const projectRoute = matchPath("/app/workspaces/:workspaceId/projects/*", location.pathname);
  const searchRoute = matchPath("/app/workspaces/:workspaceId/search", location.pathname);
  const routeWorkspaceId = workspaceRoute?.params.workspaceId;
  const activeWorkspace = routeWorkspaceId
    ? workspaces.workspaces.find(workspace => workspace.id === routeWorkspaceId)
    : workspaces.active;
  const [dark, setDark] = useState(() => localStorage.getItem("collabflow-theme") === "dark");
  const [mobileNav, setMobileNav] = useState(false);
  const [createRequest, setCreateRequest] = useState(0);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("collabflow-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (!mobileNav) return;
    const previous = document.body.style.overflow;
    if (window.matchMedia("(max-width: 760px)").matches) document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobileNav(false); menuButton.current?.focus(); }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", escape);
    };
  }, [mobileNav]);

  const projectsPath = activeWorkspace ? `/app/workspaces/${activeWorkspace.id}/projects` : "";
  const navItems = [
    { to: "/app", icon: LayoutDashboard, name: "Dashboard" },
    ...(activeWorkspace ? [
      { to: "/app/my-tasks", icon: ListTodo, name: "My tasks" },
      { to: projectsPath, icon: FolderKanban, name: "Projects" },
      { to: "/app/members", icon: Users, name: "Members" },
    ] : []),
    { to: "/app/settings", icon: Settings, name: "Settings" },
  ];
  const section = searchRoute ? "Search" : projectRoute || location.pathname === "/app/projects" ? "Projects"
    : location.pathname === "/app/notifications" ? "Notifications"
    : navItems.find(item => item.to === location.pathname)?.name ?? "Page unavailable";

  function startWorkspace() {
    setMobileNav(true);
    setCreateRequest(value => value + 1);
  }

  function content() {
    if (location.pathname === "/app/notifications") return <NotificationInbox inbox={inbox} />;
    if (location.pathname === "/app/settings") return <section className="panel workspace-empty">
      <h1>Settings</h1>
      <h2>Account</h2><p>{user.name}</p><p>{user.email}</p>
      <h2>Appearance</h2>
      <label className="theme-setting">Theme
        <select value={dark ? "dark" : "light"} onChange={event => setDark(event.target.value === "dark")}>
          <option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </label>
    </section>;
    if (workspaces.loading) return <p role="status">Loading workspace…</p>;
    if (workspaces.error) return <section className="panel workspace-empty">
      <p role="alert">Could not load your workspaces.</p><button className="primary-button" onClick={workspaces.retry}>Retry loading</button>
    </section>;
    if (routeWorkspaceId && !activeWorkspace) return <section className="panel workspace-empty">
      <h1>Workspace unavailable</h1><Link to="/app">Back to dashboard</Link>
    </section>;
    if (location.pathname === "/app" && !activeWorkspace) return <section className="panel workspace-empty onboarding">
      <div className="onboarding-icon"><FolderKanban size={28} /></div>
      <h1>Create your first workspace</h1>
      <p>Organize your projects, invite teammates, and track work together.</p>
      <button className="primary-button" onClick={startWorkspace}><Plus size={17} /> Create workspace</button>
    </section>;
    if (activeWorkspace) {
      if (location.pathname === "/app" || location.pathname === "/app/my-tasks") return <WorkspaceDashboard key={activeWorkspace.id} workspace={activeWorkspace} myTasks={location.pathname === "/app/my-tasks"} />;
      if (location.pathname === "/app/members") return <WorkspaceMembers key={activeWorkspace.id} workspace={activeWorkspace} />;
      if (location.pathname === "/app/projects") return <Navigate to={projectsPath} replace />;
      if (searchRoute) return <WorkspaceSearch key={activeWorkspace.id} workspace={activeWorkspace} />;
      if (projectRoute) return <WorkspaceProjects key={activeWorkspace.id} workspace={activeWorkspace} />;
    }
    return <section className="panel workspace-empty"><h1>Page unavailable</h1><Link to="/app">Back to dashboard</Link></section>;
  }

  return <div className="app">
    <aside id="app-sidebar" className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Command size={19} /></div><span>collab<span className="brand-accent">flow</span></span>
        <button className="icon-button mobile-menu" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button>
      </div>
      <WorkspaceSwitcher state={{ ...workspaces, active: activeWorkspace }} createRequest={createRequest} onSwitch={() => navigate("/app")} />
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Workspace navigation">{navItems.map(item => <Link key={item.to} className={`nav-item ${location.pathname === item.to || (item.to === projectsPath && projectRoute) ? "active" : ""}`}
        to={item.to} onClick={() => {
          if (activeWorkspace && !item.to.startsWith("/app/workspaces/")) workspaces.selectWorkspace(activeWorkspace.id);
          setMobileNav(false);
        }}><item.icon size={18} />{item.name}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="avatar">{initials}</div><span><strong>{user.name}</strong><small>{user.email}</small></span>
        <button aria-label="Toggle dark mode" className="icon-button" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <SignOut onSignOut={onSignOut} />
      </div>
    </aside>
    {mobileNav && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
    <main className="main">
      <header className="topbar"><div className="topbar-left">
        <button ref={menuButton} className="icon-button mobile-menu" aria-controls="app-sidebar" aria-expanded={mobileNav}
          onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button>
        <span className="topbar-workspace" title={activeWorkspace?.name}>{activeWorkspace?.name ?? "CollabFlow"}</span><span className="slash">/</span><strong>{section}</strong>
      </div><div className="topbar-actions">{activeWorkspace && <WorkspaceSearchButton key={activeWorkspace.id} workspace={activeWorkspace} />}<NotificationBell inbox={inbox} /><span className="top-avatar">{initials}</span></div></header>
      <div className="page">{content()}</div>
    </main>
  </div>;
}

export default function App() {
  const { session, setSession, failed, retry } = useSession();
  if (session === undefined) return <main className="auth-layout"><section className="auth-card">
    {failed ? <><p role="alert">Could not check your session.</p><button className="primary-button" onClick={retry}>Try again</button></> : <p role="status">Checking your session…</p>}
  </section></main>;
  return <Routes>
    <Route path="/invite" element={<AcceptInvitation user={session} />} />
    <Route path="/login" element={<AuthPage key="login" mode="login" user={session} onUser={setSession} />} />
    <Route path="/register" element={<AuthPage key="register" mode="register" user={session} onUser={setSession} />} />
    <Route path="/app/*" element={<RequireSession>{session && <AppShell key={session.id} user={session} onSignOut={() => setSession(null)} />}</RequireSession>} />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes>;
}
