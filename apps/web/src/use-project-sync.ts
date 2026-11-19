import { useEffect, useState } from "react";
import { io } from "socket.io-client";

export function useProjectSync(workspaceId: string, projectId: string, onChange: () => void) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    const socket = io({ withCredentials: true, autoConnect: false });
    socket.on("connect", () => {
      socket.emit("subscribe-project", { workspaceId, projectId }, (result: { ok: boolean }) => {
        if (!result.ok) { socket.disconnect(); return; }
        setConnected(true);
        onChange();
      });
    });
    socket.on("project-changed", onChange);
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    const refresh = () => {
      if (document.visibilityState === "visible") {
        if (!socket.connected) socket.connect();
        onChange();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    socket.connect();
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [workspaceId, projectId, onChange]);
  return connected;
}
