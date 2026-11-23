import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";

type Notice = { id: string; message: string; href: string | null; readAt: string | null; createdAt: string };
type Inbox = { unread: number; total: number; nextCursor: string | null; notifications: Notice[] };

export function useNotifications() {
  const [data, setData] = useState<Inbox | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const visibleRefresh = () => { if (document.visibilityState === "visible") refresh(); };
    const interval = window.setInterval(visibleRefresh, 30_000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    async function fetchPage(cursor?: string): Promise<Inbox> {
      const response = await fetch(`/api/notifications${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Could not load notifications.");
      return response.json();
    }
    async function load() {
      let inbox = await fetchPage();
      for (let page = 1; page < pages && inbox.nextCursor; page++) {
        const older = await fetchPage(inbox.nextCursor);
        inbox = { ...inbox, nextCursor: older.nextCursor, notifications: [...inbox.notifications, ...older.notifications] };
      }
      if (!controller.signal.aborted) { setData(inbox); setFailed(false); }
    }
    load().catch(() => { if (!controller.signal.aborted) { setData(null); setFailed(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt, pages]);

  async function markRead(id: string) {
    setPending(current => new Set(current).add(id));
    setError("");
    try {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error("Could not mark the notification as read.");
      refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); }
    finally {
      setPending(current => { const next = new Set(current); next.delete(id); return next; });
    }
  }
  return { data, failed, loading, pending, error, refresh, markRead, loadOlder: () => setPages(value => value + 1) };
}

export function NotificationBell({ inbox }: { inbox: ReturnType<typeof useNotifications> }) {
  const unread = inbox.data?.unread;
  return <Link to="/app/notifications" className="notification-bell" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
    <Bell size={19} />
    {Boolean(unread) && <span aria-hidden="true">{unread! > 99 ? "99+" : unread}</span>}
  </Link>;
}

export function NotificationInbox({ inbox }: { inbox: ReturnType<typeof useNotifications> }) {
  return <section className="panel workspace-empty" aria-labelledby="notifications-title">
    <div className="project-page-heading"><h1 id="notifications-title">Notifications</h1>
      <button className="project-secondary" disabled={inbox.loading} onClick={inbox.refresh}>Refresh notifications</button></div>
    {inbox.error && <p role="alert">{inbox.error}</p>}
    {inbox.failed ? <><p role="alert">Could not load notifications.</p><button className="primary-button" onClick={inbox.refresh}>Try again</button></>
      : !inbox.data ? <p role="status">Loading notifications…</p> : <>
        <p role="status">{inbox.data.unread} unread</p>
        {inbox.data.notifications.length ? <ol className="notification-list">{inbox.data.notifications.map(notice => <li key={notice.id}>
          <p>{notice.href ? <Link className="project-back" to={notice.href}>{notice.message}</Link> : notice.message}</p>
          <time dateTime={notice.createdAt}>{new Date(notice.createdAt).toLocaleString()}</time>
          {!notice.readAt ? <button className="project-secondary" disabled={inbox.pending.has(notice.id)} onClick={() => void inbox.markRead(notice.id)}>Mark as read</button> : <span>Read</span>}
        </li>)}</ol> : <p>No notifications yet.</p>}
        {inbox.data.nextCursor && <button className="project-secondary" disabled={inbox.loading} onClick={inbox.loadOlder}>Load older notifications</button>}
      </>}
  </section>;
}
