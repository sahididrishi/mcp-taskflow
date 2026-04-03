import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";
import type {
  Project,
  Task,
  TaskWithDetails,
  TaskTimeBreakdown,
  TimeEntry,
  Note,
  Tag,
  TimeReport,
  Dashboard,
  SearchResult,
  ProjectExport,
} from "./types.js";
import { NotFoundError, ValidationError, ConflictError } from "./errors.js";

// ── Schema migrations ───────────────────────────────────────
// Each migration runs once, tracked by version number.
// To evolve the schema, append a new entry — never modify existing ones.

const MIGRATIONS: Array<{ version: number; up: string }> = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS projects (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','paused','completed','archived')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id   INTEGER NOT NULL,
        title        TEXT NOT NULL,
        description  TEXT,
        status       TEXT NOT NULL DEFAULT 'todo'
                     CHECK(status IN ('todo','in_progress','review','done','blocked')),
        priority     TEXT NOT NULL DEFAULT 'medium'
                     CHECK(priority IN ('low','medium','high','urgent')),
        due_date     TEXT,
        completed_at TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     INTEGER NOT NULL,
        description TEXT,
        minutes     INTEGER NOT NULL CHECK(minutes > 0),
        logged_at   TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        task_id    INTEGER,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id)    REFERENCES tasks(id)    ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color TEXT NOT NULL DEFAULT '#6B7280'
      );

      CREATE TABLE IF NOT EXISTS task_tags (
        task_id INTEGER NOT NULL,
        tag_id  INTEGER NOT NULL,
        PRIMARY KEY (task_id, tag_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority   ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date   ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_time_task        ON time_entries(task_id);
      CREATE INDEX IF NOT EXISTS idx_time_logged      ON time_entries(logged_at);
      CREATE INDEX IF NOT EXISTS idx_notes_project    ON notes(project_id);
      CREATE INDEX IF NOT EXISTS idx_notes_task       ON notes(task_id);
    `,
  },
];

// ── Database class ──────────────────────────────────────────

export class TaskflowDB {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath =
      dbPath ??
      process.env.TASKFLOW_DB_PATH ??
      path.join(os.homedir(), ".mcp-taskflow", "taskflow.db");

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  // ── Migrations ──────────────────────────────────────────

  private migrate(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_version (
         version INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    );

    const applied = new Set(
      (this.db.prepare("SELECT version FROM schema_version").all() as Array<{ version: number }>).map(
        (r) => r.version
      )
    );

    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        this.db.transaction(() => {
          this.db.exec(migration.up);
          this.db
            .prepare("INSERT INTO schema_version (version) VALUES (?)")
            .run(migration.version);
        })();
      }
    }
  }

  // ── Projects ────────────────────────────────────────────

  /** Create a new project. Throws if name already exists (UNIQUE constraint). */
  createProject(name: string, description?: string): Project {
    const stmt = this.db.prepare(
      "INSERT INTO projects (name, description) VALUES (?, ?)"
    );
    const result = stmt.run(name, description ?? null);
    return this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(result.lastInsertRowid) as Project;
  }

  getProject(id: number): Project | null {
    return (
      (this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project) ??
      null
    );
  }

  listProjects(status?: string): Project[] {
    if (status) {
      return this.db
        .prepare("SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC")
        .all(status) as Project[];
    }
    return this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as Project[];
  }

  updateProject(
    id: number,
    updates: { name?: string; description?: string; status?: string }
  ): Project | null {
    if (!this.getProject(id)) return null;
    this.buildUpdate("projects", id, updates);
    return this.getProject(id);
  }

  deleteProject(id: number): Project | null {
    const project = this.getProject(id);
    if (!project) return null;
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return project;
  }

  // ── Tasks ───────────────────────────────────────────────

  /** Create a task in a project. Throws NotFoundError if project does not exist. */
  createTask(
    projectId: number,
    title: string,
    opts?: {
      description?: string;
      priority?: string;
      due_date?: string;
      tags?: string[];
    }
  ): TaskWithDetails {
    const project = this.getProject(projectId);
    if (!project) throw new NotFoundError("Project", projectId);

    const stmt = this.db.prepare(
      `INSERT INTO tasks (project_id, title, description, priority, due_date)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      projectId,
      title,
      opts?.description ?? null,
      opts?.priority ?? "medium",
      opts?.due_date ?? null
    );

    const taskId = result.lastInsertRowid as number;

    if (opts?.tags?.length) {
      for (const tagName of opts.tags) {
        this.tagTask(taskId, tagName);
      }
    }

    return this.getTaskWithDetails(taskId)!;
  }

  getTask(id: number): Task | null {
    return (
      (this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task) ?? null
    );
  }

  getTaskWithDetails(id: number): TaskWithDetails | null {
    const task = this.db
      .prepare(
        `SELECT t.*, p.name as project_name,
                COALESCE((SELECT SUM(minutes) FROM time_entries WHERE task_id = t.id), 0) as total_minutes,
                GROUP_CONCAT(DISTINCT tg.name) as tag_list
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN task_tags tt ON tt.task_id = t.id
         LEFT JOIN tags tg ON tg.id = tt.tag_id
         WHERE t.id = ?
         GROUP BY t.id`
      )
      .get(id) as (TaskWithDetails & { tag_list?: string | null }) | undefined;

    if (!task) return null;
    task.tags = task.tag_list ? task.tag_list.split(",").sort() : [];
    delete task.tag_list;
    return task;
  }

  listTasks(
    projectId: number,
    opts?: { status?: string; tag?: string }
  ): TaskWithDetails[] {
    let query = `
      SELECT t.*, p.name as project_name,
             COALESCE((SELECT SUM(minutes) FROM time_entries WHERE task_id = t.id), 0) as total_minutes,
             GROUP_CONCAT(DISTINCT tg.name) as tag_list
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN task_tags tt ON tt.task_id = t.id
      LEFT JOIN tags tg ON tg.id = tt.tag_id
      WHERE t.project_id = ?
    `;
    const params: (string | number | null)[] = [projectId];

    if (opts?.status) {
      query += " AND t.status = ?";
      params.push(opts.status);
    }
    if (opts?.tag) {
      query += `
        AND t.id IN (
          SELECT tt2.task_id FROM task_tags tt2
          JOIN tags tg2 ON tg2.id = tt2.tag_id
          WHERE tg2.name = ? COLLATE NOCASE
        )`;
      params.push(opts.tag);
    }

    query += " GROUP BY t.id";
    query += " ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, t.created_at DESC";

    const tasks = this.db.prepare(query).all(...params) as Array<TaskWithDetails & { tag_list?: string | null }>;
    for (const task of tasks) {
      task.tags = task.tag_list ? task.tag_list.split(",").sort() : [];
      delete task.tag_list;
    }
    return tasks;
  }

  /** Update task fields. Auto-manages completed_at when status changes to/from done. */
  updateTask(
    id: number,
    updates: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      due_date?: string;
    }
  ): TaskWithDetails | null {
    const existing = this.getTask(id);
    if (!existing) return null;

    // Handle completed_at logic as extra SQL
    const extraSql: string[] = [];
    if (updates.status !== undefined) {
      if (updates.status === "done" && existing.status !== "done") {
        extraSql.push("completed_at = datetime('now')");
      } else if (updates.status !== "done" && existing.status === "done") {
        extraSql.push("completed_at = NULL");
      }
    }

    // Normalize due_date: empty string means clear
    const normalizedUpdates: Record<string, string | number | null | undefined> = { ...updates };
    if (normalizedUpdates.due_date !== undefined) {
      normalizedUpdates.due_date = normalizedUpdates.due_date || null;
    }

    this.buildUpdate("tasks", id, normalizedUpdates, extraSql.length > 0 ? extraSql : undefined);
    return this.getTaskWithDetails(id);
  }

  deleteTask(id: number): Task | null {
    const task = this.getTask(id);
    if (!task) return null;
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return task;
  }

  // ── Tags ────────────────────────────────────────────────

  createTag(name: string, color?: string): Tag {
    const existing = this.db
      .prepare("SELECT * FROM tags WHERE name = ? COLLATE NOCASE")
      .get(name) as Tag | undefined;
    if (existing) return existing;

    this.db
      .prepare("INSERT INTO tags (name, color) VALUES (?, ?)")
      .run(name, color ?? "#6B7280");
    return this.db
      .prepare("SELECT * FROM tags WHERE name = ? COLLATE NOCASE")
      .get(name) as Tag;
  }

  listAllTags(): Tag[] {
    return this.db
      .prepare(
        `SELECT t.*, COUNT(tt.task_id) as usage_count
         FROM tags t
         LEFT JOIN task_tags tt ON tt.tag_id = t.id
         GROUP BY t.id
         ORDER BY usage_count DESC, t.name`
      )
      .all() as Tag[];
  }

  tagTask(taskId: number, tagName: string, color?: string): void {
    if (!this.getTask(taskId)) throw new NotFoundError("Task", taskId);
    const tag = this.createTag(tagName, color);
    this.db
      .prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)")
      .run(taskId, tag.id);
  }

  untagTask(taskId: number, tagName: string): boolean {
    const tag = this.db
      .prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
      .get(tagName) as { id: number } | undefined;
    if (!tag) return false;

    const result = this.db
      .prepare("DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?")
      .run(taskId, tag.id);
    return result.changes > 0;
  }

  getTaskTags(taskId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT tg.name FROM tags tg
         JOIN task_tags tt ON tt.tag_id = tg.id
         WHERE tt.task_id = ?
         ORDER BY tg.name`
      )
      .all(taskId) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  deleteTag(name: string): boolean {
    const result = this.db
      .prepare("DELETE FROM tags WHERE name = ? COLLATE NOCASE")
      .run(name);
    return result.changes > 0;
  }

  // ── Time tracking ──────────────────────────────────────

  /** Log minutes spent on a task. Throws NotFoundError if task does not exist. */
  logTime(taskId: number, minutes: number, description?: string): TimeEntry {
    const task = this.getTask(taskId);
    if (!task) throw new NotFoundError("Task", taskId);

    const stmt = this.db.prepare(
      "INSERT INTO time_entries (task_id, minutes, description) VALUES (?, ?, ?)"
    );
    const result = stmt.run(taskId, minutes, description ?? null);
    return this.db
      .prepare("SELECT * FROM time_entries WHERE id = ?")
      .get(result.lastInsertRowid) as TimeEntry;
  }

  /** Generate a per-task time breakdown for a project, optionally filtered by date range. */
  getTimeReport(
    projectId: number,
    dateRange?: { from?: string; to?: string }
  ): TimeReport {
    const project = this.getProject(projectId);
    if (!project) throw new NotFoundError("Project", projectId);

    let timeFilter = "";
    const timeParams: string[] = [];

    if (dateRange?.from) {
      timeFilter += " AND te.logged_at >= ?";
      timeParams.push(dateRange.from);
    }
    if (dateRange?.to) {
      timeFilter += " AND te.logged_at <= ?";
      timeParams.push(dateRange.to + " 23:59:59");
    }

    const tasks = this.db
      .prepare(
        `SELECT t.id, t.title, t.status,
                COALESCE(SUM(te.minutes), 0) as total_minutes,
                COUNT(te.id) as entry_count
         FROM tasks t
         LEFT JOIN time_entries te ON te.task_id = t.id ${timeFilter ? "AND 1=1" + timeFilter : ""}
         WHERE t.project_id = ?
         GROUP BY t.id
         ORDER BY total_minutes DESC`
      )
      .all(...timeParams, projectId) as TaskTimeBreakdown[];

    const totalMinutes = tasks.reduce(
      (sum: number, t: TaskTimeBreakdown) => sum + t.total_minutes,
      0
    );

    return {
      project_id: projectId,
      project_name: project.name,
      total_time: formatMinutes(totalMinutes),
      total_minutes: totalMinutes,
      date_range: {
        from: dateRange?.from ?? null,
        to: dateRange?.to ?? null,
      },
      tasks,
    };
  }

  // ── Notes ───────────────────────────────────────────────

  /** Add a note to a project or task. Throws ValidationError if neither is specified. */
  addNote(
    content: string,
    opts?: { project_id?: number; task_id?: number }
  ): Note {
    if (!opts?.project_id && !opts?.task_id) {
      throw new ValidationError("Note must be attached to a project or task");
    }
    if (opts?.project_id && !this.getProject(opts.project_id)) {
      throw new NotFoundError("Project", opts.project_id);
    }
    if (opts?.task_id && !this.getTask(opts.task_id)) {
      throw new NotFoundError("Task", opts.task_id);
    }

    const stmt = this.db.prepare(
      "INSERT INTO notes (project_id, task_id, content) VALUES (?, ?, ?)"
    );
    const result = stmt.run(
      opts?.project_id ?? null,
      opts?.task_id ?? null,
      content
    );
    return this.db
      .prepare("SELECT * FROM notes WHERE id = ?")
      .get(result.lastInsertRowid) as Note;
  }

  listNotes(opts?: { project_id?: number; task_id?: number }): Note[] {
    if (opts?.task_id) {
      return this.db
        .prepare(
          "SELECT * FROM notes WHERE task_id = ? ORDER BY created_at DESC"
        )
        .all(opts.task_id) as Note[];
    }
    if (opts?.project_id) {
      return this.db
        .prepare(
          "SELECT * FROM notes WHERE project_id = ? OR task_id IN (SELECT id FROM tasks WHERE project_id = ?) ORDER BY created_at DESC"
        )
        .all(opts.project_id, opts.project_id) as Note[];
    }
    return this.db
      .prepare("SELECT * FROM notes ORDER BY created_at DESC LIMIT 50")
      .all() as Note[];
  }

  deleteNote(id: number): boolean {
    const result = this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ── Search ──────────────────────────────────────────────

  /** Full-text search across projects, tasks, and notes. Optionally limit to one scope. */
  search(query: string, scope?: "projects" | "tasks" | "notes"): SearchResult[] {
    const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
    const results: SearchResult[] = [];

    if (!scope || scope === "projects") {
      const projects = this.db
        .prepare(
          `SELECT id, name as title, COALESCE(description, '') as snippet
           FROM projects
           WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
           ORDER BY updated_at DESC
           LIMIT 20`
        )
        .all(pattern, pattern) as Array<{ id: number; title: string; snippet: string }>;

      for (const p of projects) {
        results.push({
          type: "project",
          id: p.id,
          title: p.title,
          snippet: truncate(p.snippet, 120),
          project_name: p.title,
        });
      }
    }

    if (!scope || scope === "tasks") {
      const tasks = this.db
        .prepare(
          `SELECT t.id, t.title, COALESCE(t.description, '') as snippet, p.name as project_name
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
           WHERE t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\'
           ORDER BY t.updated_at DESC
           LIMIT 30`
        )
        .all(pattern, pattern) as Array<{ id: number; title: string; snippet: string; project_name: string }>;

      for (const t of tasks) {
        results.push({
          type: "task",
          id: t.id,
          title: t.title,
          snippet: truncate(t.snippet, 120),
          project_name: t.project_name,
        });
      }
    }

    if (!scope || scope === "notes") {
      const notes = this.db
        .prepare(
          `SELECT n.id, n.content as snippet,
                  COALESCE(p.name, '') as project_name
           FROM notes n
           LEFT JOIN projects p ON p.id = n.project_id
           WHERE n.content LIKE ? ESCAPE '\\'
           ORDER BY n.created_at DESC
           LIMIT 20`
        )
        .all(pattern) as Array<{ id: number; snippet: string; project_name: string }>;

      for (const n of notes) {
        results.push({
          type: "note",
          id: n.id,
          title: "Note",
          snippet: truncate(n.snippet, 120),
          project_name: n.project_name || null,
        });
      }
    }

    return results;
  }

  // ── Dashboard ───────────────────────────────────────────

  /** Return a high-level overview of active projects, task stats, and time logged. */
  getDashboard(): Dashboard {
    const projects = this.db
      .prepare(
        `SELECT p.id, p.name,
                (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'done') as task_count
         FROM projects p
         WHERE p.status = 'active'
         ORDER BY p.updated_at DESC`
      )
      .all() as Array<{ id: number; name: string; task_count: number }>;

    const taskStats = this.db
      .prepare(
        `SELECT status, COUNT(*) as count FROM tasks
         WHERE project_id IN (SELECT id FROM projects WHERE status = 'active')
         GROUP BY status`
      )
      .all() as Array<{ status: string; count: number }>;

    const urgentTasks = this.fetchTasksWithDetails(
      `WHERE t.priority = 'urgent' AND t.status NOT IN ('done') ORDER BY t.created_at ASC LIMIT 10`
    );

    const overdueTasks = this.fetchTasksWithDetails(
      `WHERE t.due_date < date('now') AND t.status NOT IN ('done') ORDER BY t.due_date ASC LIMIT 10`
    );

    const recentlyCompleted = this.fetchTasksWithDetails(
      `WHERE t.status = 'done' AND t.completed_at >= datetime('now', '-7 days') ORDER BY t.completed_at DESC LIMIT 5`
    );

    const todayTime = this.db
      .prepare(
        `SELECT COALESCE(SUM(minutes), 0) as total
         FROM time_entries WHERE date(logged_at) = date('now')`
      )
      .get() as { total: number };

    const weekTime = this.db
      .prepare(
        `SELECT COALESCE(SUM(minutes), 0) as total
         FROM time_entries WHERE logged_at >= datetime('now', '-7 days')`
      )
      .get() as { total: number };

    const tagDist = this.db
      .prepare(
        `SELECT tg.name as tag, COUNT(tt.task_id) as count
         FROM tags tg
         JOIN task_tags tt ON tt.tag_id = tg.id
         JOIN tasks t ON t.id = tt.task_id AND t.status != 'done'
         GROUP BY tg.id
         ORDER BY count DESC
         LIMIT 10`
      )
      .all() as Array<{ tag: string; count: number }>;

    return {
      active_projects: projects.length,
      projects,
      task_summary: Object.fromEntries(taskStats.map((s) => [s.status, s.count])),
      urgent_tasks: urgentTasks,
      overdue_tasks: overdueTasks,
      recently_completed: recentlyCompleted,
      today_logged: formatMinutes(todayTime.total),
      week_logged: formatMinutes(weekTime.total),
      tag_distribution: tagDist,
    };
  }

  // ── Export ──────────────────────────────────────────────

  /** Export a complete project snapshot including tasks, notes, and time data. */
  exportProject(projectId: number): ProjectExport {
    const project = this.getProject(projectId);
    if (!project) throw new NotFoundError("Project", projectId);

    const tasks = this.listTasks(projectId);
    const notes = this.listNotes({ project_id: projectId });
    const timeReport = this.getTimeReport(projectId);

    return {
      project,
      tasks,
      notes,
      time_report: timeReport,
      exported_at: new Date().toISOString(),
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private buildUpdate(
    table: string,
    id: number,
    updates: Record<string, string | number | null | undefined>,
    extraSql?: string[]
  ): boolean {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (extraSql) fields.push(...extraSql);
    if (fields.length === 0) return false;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db.prepare(`UPDATE ${table} SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return true;
  }

  private fetchTasksWithDetails(whereClause: string): TaskWithDetails[] {
    // Extract ORDER BY / LIMIT from whereClause so GROUP BY can go between
    const orderMatch = whereClause.match(/(ORDER BY .*)$/i);
    const orderClause = orderMatch ? orderMatch[1] : "";
    const filterClause = orderMatch ? whereClause.slice(0, orderMatch.index).trim() : whereClause;

    const tasks = this.db
      .prepare(
        `SELECT t.*, p.name as project_name,
                COALESCE((SELECT SUM(minutes) FROM time_entries WHERE task_id = t.id), 0) as total_minutes,
                GROUP_CONCAT(DISTINCT tg.name) as tag_list
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN task_tags tt ON tt.task_id = t.id
         LEFT JOIN tags tg ON tg.id = tt.tag_id
         ${filterClause}
         GROUP BY t.id
         ${orderClause}`
      )
      .all() as Array<TaskWithDetails & { tag_list?: string | null }>;

    for (const task of tasks) {
      task.tags = task.tag_list ? task.tag_list.split(",").sort() : [];
      delete task.tag_list;
    }
    return tasks;
  }
}

// ── Utility functions ───────────────────────────────────────

function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}h ${mins}m`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
