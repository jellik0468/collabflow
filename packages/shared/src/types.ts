export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type WorkspaceRole = "owner" | "member";
export interface TaskSummary { id: string; title: string; status: TaskStatus; priority: TaskPriority; assigneeId: string | null; dueDate: string | null; }
