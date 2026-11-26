import { apiFetch } from "./api";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useProjectSync } from "./use-project-sync";

type Comment = { id: string; body: string; createdAt: string; author: { id: string; name: string } };
type CommentPage = { comments: Comment[]; viewerId: string; nextCursor: string | null };

async function commentRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, { cache: "no-store", ...options });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "Comments are unavailable. Try again.");
  return data;
}

export function TaskComments({ workspaceId, projectId, taskId, archived }: {
  workspaceId: string; projectId: string; taskId: string; archived: boolean;
}) {
  const endpoint = `/api/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments`;
  const [data, setData] = useState<CommentPage | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useProjectSync(workspaceId, projectId, refresh);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    async function load() {
      let result: CommentPage = await commentRequest(endpoint, { signal: controller.signal });
      for (let page = 1; page < pages && result.nextCursor; page++) {
        const older: CommentPage = await commentRequest(`${endpoint}?before=${encodeURIComponent(result.nextCursor)}`, { signal: controller.signal });
        result = { ...older, comments: [...older.comments, ...result.comments] };
      }
      if (!controller.signal.aborted) { setData(result); setLoadError(false); }
    }
    load().catch(() => { if (!controller.signal.aborted) { setLoadError(true); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, pages, attempt]);

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!body.trim()) { setError("Enter a comment."); return; }
    setPending(true);
    setError("");
    setNotice("");
    try {
      await commentRequest(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
      });
      setBody("");
      setNotice("Comment added.");
      refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not post comment."); }
    finally { setPending(false); }
  }

  async function remove(id: string) {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await commentRequest(`${endpoint}/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
      setConfirming(null);
      setNotice("Comment deleted.");
      refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not delete comment."); }
    finally { setPending(false); }
  }

  return <section className="task-comments" aria-labelledby="task-comments-title">
    <h3 id="task-comments-title">Comments</h3>
    {loadError ? <><p role="alert">Could not load comments.</p><button className="project-secondary" onClick={refresh}>Retry comments</button></>
      : !data ? <p role="status">Loading comments…</p> : <>
        {data.nextCursor && <button className="project-secondary" disabled={loading} onClick={() => setPages(value => value + 1)}>Load older comments</button>}
        {data.comments.length ? <ol className="comment-list">{data.comments.map(comment => <li key={comment.id}>
          <div className="comment-byline"><strong>{comment.author.name}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time></div>
          <p className="comment-body">{comment.body}</p>
          {!archived && comment.author.id === data.viewerId && (confirming === comment.id
            ? <div className="comment-confirm"><p>Delete this comment?</p><div className="project-actions">
              <button className="project-secondary" disabled={pending} onClick={() => remove(comment.id)}>Confirm comment deletion</button>
              <button className="project-secondary" disabled={pending} onClick={() => setConfirming(null)}>Cancel</button>
            </div></div>
            : <button className="project-secondary" disabled={pending} onClick={() => { setError(""); setConfirming(comment.id); }}>Delete comment</button>)}
        </li>)}</ol> : <p>No comments yet.</p>}
      </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!archived && <form className="project-form" onSubmit={post}>
      <label>Add a comment<textarea value={body} onChange={event => setBody(event.target.value)} required maxLength={2000} rows={3} disabled={pending} /></label>
      <button className="primary-button" disabled={pending}>{pending ? "Saving…" : "Post comment"}</button>
    </form>}
    {archived && <p>Comments are read-only in archived projects.</p>}
  </section>;
}
