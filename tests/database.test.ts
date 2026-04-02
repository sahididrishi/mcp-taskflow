import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TaskflowDB } from "../src/database.js";
import fs from "fs";
import path from "path";
import os from "os";

let db: TaskflowDB;
let tmpDir: string;
let dbPath: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskflow-test-"));
  dbPath = path.join(tmpDir, "test.db");
  db = new TaskflowDB(dbPath);
});

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Projects ──────────────────────────────────────────────

describe("Projects", () => {
  it("creates a project", () => {
    const project = db.createProject("Test Project", "A test project");
    assert.equal(project.name, "Test Project");
    assert.equal(project.description, "A test project");
    assert.equal(project.status, "active");
    assert.ok(project.id);
  });

  it("rejects duplicate project names", () => {
    assert.throws(() => db.createProject("Test Project"), /UNIQUE/);
  });

  it("lists all projects", () => {
    db.createProject("Second Project");
    const projects = db.listProjects();
    assert.ok(projects.length >= 2);
  });

  it("filters projects by status", () => {
    const active = db.listProjects("active");
    assert.ok(active.every((p) => p.status === "active"));
  });

  it("updates a project", () => {
    const projects = db.listProjects();
    const updated = db.updateProject(projects[0].id, {
      status: "paused",
      description: "Updated description",
    });
    assert.equal(updated?.status, "paused");
    assert.equal(updated?.description, "Updated description");
  });

  it("returns null when updating non-existent project", () => {
    const result = db.updateProject(99999, { name: "No" });
    assert.equal(result, null);
  });

  it("deletes a project", () => {
    const project = db.createProject("To Delete");
    const deleted = db.deleteProject(project.id);
    assert.equal(deleted?.id, project.id);
    assert.equal(db.getProject(project.id), null);
  });
});

// ── Tasks ─────────────────────────────────────────────────

describe("Tasks", () => {
  let projectId: number;

  before(() => {
    const project = db.createProject("Task Test Project");
    projectId = project.id;
  });

  it("creates a task with defaults", () => {
    const task = db.createTask(projectId, "First task");
    assert.equal(task.title, "First task");
    assert.equal(task.status, "todo");
    assert.equal(task.priority, "medium");
    assert.deepEqual(task.tags, []);
  });

  it("creates a task with all options", () => {
    const task = db.createTask(projectId, "Full task", {
      description: "Detailed description",
      priority: "urgent",
      due_date: "2025-12-31",
      tags: ["frontend", "bug"],
    });
    assert.equal(task.priority, "urgent");
    assert.equal(task.due_date, "2025-12-31");
    assert.deepEqual(task.tags, ["bug", "frontend"]);
  });

  it("throws when creating task for non-existent project", () => {
    assert.throws(() => db.createTask(99999, "Bad task"), /not found/);
  });

  it("lists tasks for a project", () => {
    const tasks = db.listTasks(projectId);
    assert.ok(tasks.length >= 2);
  });

  it("filters tasks by status", () => {
    const tasks = db.listTasks(projectId, { status: "todo" });
    assert.ok(tasks.every((t) => t.status === "todo"));
  });

  it("filters tasks by tag", () => {
    const tasks = db.listTasks(projectId, { tag: "bug" });
    assert.ok(tasks.length >= 1);
    assert.ok(tasks.every((t) => t.tags.includes("bug")));
  });

  it("sets completed_at when marking done", () => {
    const tasks = db.listTasks(projectId);
    const updated = db.updateTask(tasks[0].id, { status: "done" });
    assert.ok(updated?.completed_at);
  });

  it("clears completed_at when un-done", () => {
    const tasks = db.listTasks(projectId, { status: "done" });
    const updated = db.updateTask(tasks[0].id, { status: "in_progress" });
    assert.equal(updated?.completed_at, null);
  });

  it("deletes a task", () => {
    const task = db.createTask(projectId, "Temp task");
    const deleted = db.deleteTask(task.id);
    assert.equal(deleted?.id, task.id);
    assert.equal(db.getTask(task.id), null);
  });
});

// ── Tags ──────────────────────────────────────────────────

describe("Tags", () => {
  it("lists all tags with usage counts", () => {
    const tags = db.listAllTags();
    assert.ok(tags.length >= 2); // "frontend" and "bug" from earlier
  });

  it("is case-insensitive", () => {
    const tag1 = db.createTag("CaseSensitive");
    const tag2 = db.createTag("casesensitive");
    assert.equal(tag1.id, tag2.id);
  });

  it("untags a task", () => {
    const projects = db.listProjects();
    const tasks = db.listTasks(projects[projects.length - 1].id);
    const taskWithTags = tasks.find((t) => t.tags.length > 0);
    if (taskWithTags) {
      const tagToRemove = taskWithTags.tags[0];
      const removed = db.untagTask(taskWithTags.id, tagToRemove);
      assert.ok(removed);
    }
  });

  it("deletes a tag globally", () => {
    db.createTag("deleteme");
    const deleted = db.deleteTag("deleteme");
    assert.ok(deleted);
    assert.equal(db.deleteTag("deleteme"), false);
  });
});

// ── Time tracking ─────────────────────────────────────────

describe("Time Tracking", () => {
  let taskId: number;
  let projectId: number;

  before(() => {
    const project = db.createProject("Time Test Project");
    projectId = project.id;
    const task = db.createTask(project.id, "Timed task");
    taskId = task.id;
  });

  it("logs time to a task", () => {
    const entry = db.logTime(taskId, 30, "Working on tests");
    assert.equal(entry.minutes, 30);
    assert.equal(entry.task_id, taskId);
  });

  it("throws when logging time to non-existent task", () => {
    assert.throws(() => db.logTime(99999, 10), /not found/);
  });

  it("generates a time report", () => {
    db.logTime(taskId, 45, "More work");
    const report = db.getTimeReport(projectId);
    assert.equal(report.total_minutes, 75);
    assert.equal(report.total_time, "1h 15m");
    assert.ok(report.tasks.length >= 1);
  });

  it("filters time report by date range", () => {
    const report = db.getTimeReport(projectId, {
      from: "2020-01-01",
      to: "2020-12-31",
    });
    // No entries in 2020
    assert.equal(report.total_minutes, 0);
  });
});

// ── Notes ─────────────────────────────────────────────────

describe("Notes", () => {
  let projectId: number;
  let taskId: number;

  before(() => {
    const project = db.createProject("Notes Test Project");
    projectId = project.id;
    const task = db.createTask(project.id, "Note task");
    taskId = task.id;
  });

  it("adds a project note", () => {
    const note = db.addNote("Project-level note", { project_id: projectId });
    assert.equal(note.project_id, projectId);
    assert.equal(note.task_id, null);
  });

  it("adds a task note", () => {
    const note = db.addNote("Task-level note", { task_id: taskId });
    assert.equal(note.task_id, taskId);
  });

  it("throws for non-existent project/task", () => {
    assert.throws(() => db.addNote("Bad", { project_id: 99999 }), /not found/);
    assert.throws(() => db.addNote("Bad", { task_id: 99999 }), /not found/);
  });

  it("lists notes by project", () => {
    const notes = db.listNotes({ project_id: projectId });
    assert.ok(notes.length >= 1);
  });

  it("deletes a note", () => {
    const note = db.addNote("Temp note", { project_id: projectId });
    assert.ok(db.deleteNote(note.id));
    assert.equal(db.deleteNote(note.id), false);
  });
});

// ── Search ────────────────────────────────────────────────

describe("Search", () => {
  it("searches across all types", () => {
    const results = db.search("Test");
    assert.ok(results.length >= 1);
  });

  it("scopes search to tasks only", () => {
    const results = db.search("task", "tasks");
    assert.ok(results.every((r) => r.type === "task"));
  });

  it("scopes search to projects only", () => {
    const results = db.search("Project", "projects");
    assert.ok(results.every((r) => r.type === "project"));
  });

  it("returns empty for no matches", () => {
    const results = db.search("xyznonexistent123");
    assert.equal(results.length, 0);
  });
});

// ── Dashboard ─────────────────────────────────────────────

describe("Dashboard", () => {
  it("returns a complete dashboard", () => {
    const dashboard = db.getDashboard();
    assert.ok(typeof dashboard.active_projects === "number");
    assert.ok(Array.isArray(dashboard.projects));
    assert.ok(typeof dashboard.task_summary === "object");
    assert.ok(Array.isArray(dashboard.urgent_tasks));
    assert.ok(Array.isArray(dashboard.overdue_tasks));
    assert.ok(Array.isArray(dashboard.recently_completed));
    assert.ok(typeof dashboard.today_logged === "string");
    assert.ok(typeof dashboard.week_logged === "string");
    assert.ok(Array.isArray(dashboard.tag_distribution));
  });
});

// ── Export ─────────────────────────────────────────────────

describe("Export", () => {
  it("exports a full project snapshot", () => {
    const projects = db.listProjects();
    const exported = db.exportProject(projects[0].id);
    assert.ok(exported.project);
    assert.ok(Array.isArray(exported.tasks));
    assert.ok(Array.isArray(exported.notes));
    assert.ok(exported.time_report);
    assert.ok(exported.exported_at);
  });

  it("throws for non-existent project", () => {
    assert.throws(() => db.exportProject(99999), /not found/);
  });
});

// ── Schema migrations ─────────────────────────────────────

describe("Migrations", () => {
  it("are idempotent — reopening the DB doesn't error", () => {
    const db2 = new TaskflowDB(dbPath);
    const projects = db2.listProjects();
    assert.ok(Array.isArray(projects));
    db2.close();
  });
});
