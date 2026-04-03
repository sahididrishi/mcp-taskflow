import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskflowDB } from "./database.js";

const TEXT = "text" as const;
const json = (data: any) => JSON.stringify(data, null, 2);
const ok = (data: any) => ({ content: [{ type: TEXT, text: json(data) }] });
const err = (msg: string) => ({ content: [{ type: TEXT, text: msg }], isError: true as const });

export function registerTools(server: McpServer, db: TaskflowDB): void {
  // ── Projects ──────────────────────────────────────────

  server.tool(
    "create_project",
    "Create a new project to organize tasks and track time",
    {
      name: z.string().min(1).describe("Unique project name"),
      description: z.string().optional().describe("What this project is about"),
    },
    async ({ name, description }) => {
      try {
        return ok(db.createProject(name, description));
      } catch (e: any) {
        return err(`Failed to create project: ${e.message}`);
      }
    }
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
    async ({ status }) => ok(db.listProjects(status))
  );

  server.tool(
    "update_project",
    "Update a project's name, description, or status",
    {
      id: z.number().describe("Project ID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      status: z
        .enum(["active", "paused", "completed", "archived"])
        .optional()
        .describe("New status"),
    },
    async ({ id, ...updates }) => {
      const project = db.updateProject(id, updates);
      return project ? ok(project) : err(`Project #${id} not found`);
    }
  );

  server.tool(
    "delete_project",
    "Permanently delete a project and ALL its tasks, time entries, and notes",
    {
      id: z.number().describe("Project ID to delete"),
    },
    async ({ id }) => {
      const project = db.deleteProject(id);
      return project
        ? ok({ deleted: true, project })
        : err(`Project #${id} not found`);
    }
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
    async ({ project_id, title, ...opts }) => {
      try {
        return ok(db.createTask(project_id, title, opts));
      } catch (e: any) {
        return err(`Failed to create task: ${e.message}`);
      }
    }
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
    async ({ project_id, status, tag }) =>
      ok(db.listTasks(project_id, { status, tag }))
  );

  server.tool(
    "update_task",
    "Update a task's title, description, status, priority, or due date. When status is set to 'done', completed_at is auto-recorded.",
    {
      id: z.number().describe("Task ID"),
      title: z.string().optional().describe("New title"),
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
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
        .optional()
        .describe("New due date (YYYY-MM-DD) or empty string to clear"),
    },
    async ({ id, ...updates }) => {
      const task = db.updateTask(id, updates);
      return task ? ok(task) : err(`Task #${id} not found`);
    }
  );

  server.tool(
    "delete_task",
    "Permanently delete a task and all its time entries and notes",
    {
      id: z.number().describe("Task ID to delete"),
    },
    async ({ id }) => {
      const task = db.deleteTask(id);
      return task ? ok({ deleted: true, task }) : err(`Task #${id} not found`);
    }
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
    async ({ task_id, tag, color }) => {
      try {
        db.tagTask(task_id, tag, color);
        return ok(db.getTaskWithDetails(task_id));
      } catch (e: any) {
        return err(`Failed to tag task: ${e.message}`);
      }
    }
  );

  server.tool(
    "untag_task",
    "Remove a tag from a task",
    {
      task_id: z.number().describe("Task ID"),
      tag: z.string().describe("Tag name to remove"),
    },
    async ({ task_id, tag }) => {
      const removed = db.untagTask(task_id, tag);
      return removed
        ? ok(db.getTaskWithDetails(task_id))
        : err(`Tag '${tag}' not found on task #${task_id}`);
    }
  );

  server.tool(
    "list_tags",
    "List all tags with usage counts",
    {},
    async () => ok(db.listAllTags())
  );

  server.tool(
    "delete_tag",
    "Delete a tag entirely (removes it from all tasks)",
    {
      name: z.string().describe("Tag name to delete"),
    },
    async ({ name }) => {
      const deleted = db.deleteTag(name);
      return deleted
        ? ok({ deleted: true, tag: name })
        : err(`Tag '${name}' not found`);
    }
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
    async ({ task_id, minutes, description }) => {
      try {
        return ok(db.logTime(task_id, minutes, description));
      } catch (e: any) {
        return err(`Failed to log time: ${e.message}`);
      }
    }
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
    async ({ project_id, from, to }) => {
      try {
        const range = from || to ? { from, to } : undefined;
        return ok(db.getTimeReport(project_id, range));
      } catch (e: any) {
        return err(`Failed to generate report: ${e.message}`);
      }
    }
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
    async ({ content, project_id, task_id }) => {
      try {
        return ok(db.addNote(content, { project_id, task_id }));
      } catch (e: any) {
        return err(`Failed to add note: ${e.message}`);
      }
    }
  );

  server.tool(
    "list_notes",
    "List notes. Filter by project or task to narrow results.",
    {
      project_id: z.number().optional().describe("Filter by project"),
      task_id: z.number().optional().describe("Filter by task"),
    },
    async ({ project_id, task_id }) => ok(db.listNotes({ project_id, task_id }))
  );

  server.tool(
    "delete_note",
    "Delete a note by ID",
    {
      id: z.number().describe("Note ID"),
    },
    async ({ id }) => {
      const deleted = db.deleteNote(id);
      return deleted
        ? ok({ deleted: true, id })
        : err(`Note #${id} not found`);
    }
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
    async ({ query, scope }) => {
      const results = db.search(query, scope);
      return ok({
        query,
        total: results.length,
        results,
      });
    }
  );

  // ── Dashboard & Export ────────────────────────────────

  server.tool(
    "dashboard",
    "Get a high-level overview: active projects, task stats, urgent/overdue items, recent completions, time logged today & this week, and tag distribution.",
    {},
    async () => ok(db.getDashboard())
  );

  server.tool(
    "export_project",
    "Export a complete project snapshot: all tasks, notes, and time data as a structured report.",
    {
      project_id: z.number().describe("Project ID to export"),
    },
    async ({ project_id }) => {
      try {
        return ok(db.exportProject(project_id));
      } catch (e: any) {
        return err(`Failed to export: ${e.message}`);
      }
    }
  );
}
