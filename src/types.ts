// ── Status & Priority enums ─────────────────────────────────

export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const PROJECT_STATUSES: ProjectStatus[] = ["active", "paused", "completed", "archived"];
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "done", "blocked"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

// ── Row types ───────────────────────────────────────────────

export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskWithDetails extends Task {
  project_name: string;
  tags: string[];
  total_minutes: number;
}

export interface TimeEntry {
  id: number;
  task_id: number;
  description: string | null;
  minutes: number;
  logged_at: string;
}

export interface Note {
  id: number;
  project_id: number | null;
  task_id: number | null;
  content: string;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

// ── Composite / report types ────────────────────────────────

export interface TaskTimeBreakdown {
  id: number;
  title: string;
  status: TaskStatus;
  total_minutes: number;
  entry_count: number;
}

export interface TimeReport {
  project_id: number;
  project_name: string;
  total_time: string;
  total_minutes: number;
  date_range: { from: string | null; to: string | null };
  tasks: TaskTimeBreakdown[];
}

export interface Dashboard {
  active_projects: number;
  projects: Array<{ id: number; name: string; task_count: number }>;
  task_summary: Record<string, number>;
  urgent_tasks: TaskWithDetails[];
  overdue_tasks: TaskWithDetails[];
  recently_completed: TaskWithDetails[];
  today_logged: string;
  week_logged: string;
  tag_distribution: Array<{ tag: string; count: number }>;
}

export interface SearchResult {
  type: "project" | "task" | "note";
  id: number;
  title: string;
  snippet: string;
  project_name: string | null;
}

export interface ProjectExport {
  project: Project;
  tasks: TaskWithDetails[];
  notes: Note[];
  time_report: TimeReport;
  exported_at: string;
}
