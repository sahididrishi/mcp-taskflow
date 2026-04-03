import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskflowDB } from "./database.js";
import { toolLog } from "./logger.js";

const TEXT = "text" as const;
const json = (data: unknown) => JSON.stringify(data, null, 2);
const ok = (data: unknown) => ({ content: [{ type: TEXT, text: json(data) }] });
const err = (msg: string) => ({ content: [{ type: TEXT, text: msg }], isError: true as const });

function withLogging(
  toolName: string,
  handler: (args: any) => Promise<any>
): (args: any) => Promise<any> {
  return async (args) => {
    const start = performance.now();
    try {
      const result = await handler(args);
      toolLog(toolName, args, Math.round(performance.now() - start), true);
      return result;
    } catch (e: any) {
      toolLog(toolName, args, Math.round(performance.now() - start), false, e.message);
      return err(`Failed: ${e.message}`);
    }
  };
}

export function registerTools(server: McpServer, db: TaskflowDB): void {
  // ── Projects ──────────────────────────────────────────

  server.tool(
    "create_project",
    "Create a new project to organize tasks and track time",
    {
      name: z.string().min(1).describe("Unique project name"),
      description: z.string().optional().describe("What this project is about"),
    },
    withLogging("create_project", async ({ name, description }) =>
      ok(db.createProject(name, description))
    )
  );

  server.tool(
    "list_projects",
    "List all projects, optionally filtered by status (active, paused, completed, archived)",
    {
      status: z
        .enum(["active", "paused", "completed", "archived"])
        .optional()
        .describe("Filter by status"),
    },
    withLogging("list_projects", async ({ status }) =>
      ok(db.listProjects(status))
    )
  );

  server.tool(
    "update_project",
    "Update a project's name, description, or status",
    {
      id: z.number().describe("Project ID"),
      name: z.string().min(1).optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      status: z
        .enum(["active", "paused", "completed", "archived"])
        .optional()
        .describe("New status"),
    },
    withLogging("update_project", async ({ id, ...updates }) => {
      const project = db.updateProject(id, updates);
      return project ? ok(project) : err(`Project #${id} not found`);
    })
  );

  server.tool(
    "delete_project",
    "Permanently delete a project and ALL its tasks, time entries, and notes",
    {
      id: z.number().describe("Project ID to delete"),
    },
    withLogging("delete_project", async ({ id }) => {
      const project = db.deleteProject(id);
      return project
        ? ok({ deleted: true, project })
        : err(`Project #${id} not found`);
    })
  );

  // ── Tasks ─────────────────────────────────────────────

  server.tool(
    "create_task",
    "Create a new task within a project. Optionally assign priority, due date, and tags.",
    {
      project_id: z.number().describe("Parent project ID"),
      title: z.string().min(1).describe("Task title"),
      description: z.string().optional().describe("Detailed task description"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("Priority level (default: medium)"),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
        .optional()
        .describe("Due date in YYYY-MM-DD format"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags to apply (auto-created if new)"),
    },
    withLogging("create_task", async ({ project_id, title, ...opts }) =>
      ok(db.createTask(project_id, title, opts))
    )
  );

  server.tool(
    "list_tasks",
    "List tasks for a project. Filter by status and/or tag.",
    {
      project_id: z.number().describe("Project ID"),
      status: z
        .enum(["todo", "in_progress", "review", "done", "blocked"])
        .optional()
        .describe("Filter by status"),
      tag: z.string().optional().describe("Filter by tag name"),
    },
    withLogging("list_tasks", async ({ project_id, status, tag }) =>
      ok(db.listTasks(project_id, { status, tag }))
    )
  );

  server.tool(
    "update_task",
    "Update a task's title, description, status, priority, or due date. When status is set to 'done', completed_at is auto-recorded.",
    {
      id: z.number().describe("Task ID"),
      title: z.string().min(1).optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      status: z
        .enum(["todo", "in_progress", "review", "done", "blocked"])
        .optional()
        .describe("New status"),
      priority: z
        .enum(["low", "medium", "high", "urgent"])
        .optional()
        .describe("New priority"),
      due_date: z
        .union([
          z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
          z.literal(""),
        ])
        .optional()
        .describe("New due date (YYYY-MM-DD) or empty string to clear"),
    },
    withLogging("update_task", async ({ id, ...updates }) => {
      const task = db.updateTask(id, updates);
      return task ? ok(task) : err(`Task #${id} not found`);
    })
  );

  server.tool(
    "delete_task",
    "Permanently delete a task and all its time entries and notes",
    {
      id: z.number().describe("Task ID to delete"),
    },
    withLogging("delete_task", async ({ id }) => {
      const task = db.deleteTask(id);
      return task ? ok({ deleted: true, task }) : err(`Task #${id} not found`);
    })
  );

  // ── Tags ──────────────────────────────────────────────

  server.tool(
    "tag_task",
    "Add a tag to a task. Creates the tag if it doesn't exist yet.",
    {
      task_id: z.number().describe("Task ID"),
      tag: z.string().describe("Tag name"),
      color: z
        .string()
        .optional()
        .describe("Hex color for new tags (e.g. '#FF5733')"),
    },
    withLogging("tag_task", async ({ task_id, tag, color }) => {
      db.tagTask(task_id, tag, color);
      return ok(db.getTaskWithDetails(task_id));
    })
  );

  server.tool(
    "untag_task",
    "Remove a tag from a task",
    {
      task_id: z.number().describe("Task ID"),
      tag: z.string().describe("Tag name to remove"),
    },
    withLogging("untag_task", async ({ task_id, tag }) => {
      const removed = db.untagTask(task_id, tag);
      return removed
        ? ok(db.getTaskWithDetails(task_id))
        : err(`Tag '${tag}' not found on task #${task_id}`);
    })
  );

  server.tool(
    "list_tags",
    "List all tags with usage counts",
    {},
    withLogging("list_tags", async () =>
      ok(db.listAllTags())
    )
  );

  server.tool(
    "delete_tag",
    "Delete a tag entirely (removes it from all tasks)",
    {
      name: z.string().describe("Tag name to delete"),
    },
    withLogging("delete_tag", async ({ name }) => {
      const deleted = db.deleteTag(name);
      return deleted
        ? ok({ deleted: true, tag: name })
        : err(`Tag '${name}' not found`);
    })
  );

  // ── Time tracking ────────────────────────────────────

  server.tool(
    "log_time",
    "Log time spent on a task. Use this to track work sessions.",
    {
      task_id: z.number().describe("Task ID"),
      minutes: z.number().min(1).describe("Minutes spent"),
      description: z
        .string()
        .optional()
        .describe("What was done during this time"),
    },
    withLogging("log_time", async ({ task_id, minutes, description }) =>
      ok(db.logTime(task_id, minutes, description))
    )
  );

  server.tool(
    "time_report",
    "Get a time tracking report for a project. Shows total hours and per-task breakdown. Optionally filter by date range.",
    {
      project_id: z.number().describe("Project ID"),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
        .optional()
        .describe("Start date filter (YYYY-MM-DD)"),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
        .optional()
        .describe("End date filter (YYYY-MM-DD)"),
    },
    withLogging("time_report", async ({ project_id, from, to }) => {
      const range = from || to ? { from, to } : undefined;
      return ok(db.getTimeReport(project_id, range));
    })
  );

  // ── Notes ─────────────────────────────────────────────

  server.tool(
    "add_note",
    "Add a note to a project or task. Supports markdown content.",
    {
      content: z.string().describe("Note content (markdown supported)"),
      project_id: z.number().optional().describe("Attach to this project"),
      task_id: z.number().optional().describe("Attach to this task"),
    },
    withLogging("add_note", async ({ content, project_id, task_id }) =>
      ok(db.addNote(content, { project_id, task_id }))
    )
  );

  server.tool(
    "list_notes",
    "List notes. Filter by project or task to narrow results.",
    {
      project_id: z.number().optional().describe("Filter by project"),
      task_id: z.number().optional().describe("Filter by task"),
    },
    withLogging("list_notes", async ({ project_id, task_id }) =>
      ok(db.listNotes({ project_id, task_id }))
    )
  );

  server.tool(
    "delete_note",
    "Delete a note by ID",
    {
      id: z.number().describe("Note ID"),
    },
    withLogging("delete_note", async ({ id }) => {
      const deleted = db.deleteNote(id);
      return deleted
        ? ok({ deleted: true, id })
        : err(`Note #${id} not found`);
    })
  );

  // ── Search ────────────────────────────────────────────

  server.tool(
    "search",
    "Search across all projects, tasks, and notes. Returns matching items with snippets.",
    {
      query: z.string().min(1).describe("Search query"),
      scope: z
        .enum(["projects", "tasks", "notes"])
        .optional()
        .describe("Limit search to a specific type"),
    },
    withLogging("search", async ({ query, scope }) => {
      const results = db.search(query, scope);
      return ok({
        query,
        total: results.length,
        results,
      });
    })
  );

  // ── Dashboard & Export ────────────────────────────────

  server.tool(
    "dashboard",
    "Get a high-level overview: active projects, task stats, urgent/overdue items, recent completions, time logged today & this week, and tag distribution.",
    {},
    withLogging("dashboard", async () =>
      ok(db.getDashboard())
    )
  );

  server.tool(
    "export_project",
    "Export a complete project snapshot: all tasks, notes, and time data as a structured report.",
    {
      project_id: z.number().describe("Project ID to export"),
    },
    withLogging("export_project", async ({ project_id }) =>
      ok(db.exportProject(project_id))
    )
  );
}
