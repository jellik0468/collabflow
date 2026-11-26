let sessionRevision = 0;
export function advanceSessionRevision() {
  sessionRevision++;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const revision = sessionRevision;
  const response = await fetch(input, init);
  if (response.status === 401 && revision === sessionRevision) {
    window.dispatchEvent(new Event("collabflow-session-expired"));
  }
  return response;
}
