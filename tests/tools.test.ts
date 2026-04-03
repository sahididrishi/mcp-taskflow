import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { TaskflowDB } from "../src/database.js";
import { NotFoundError, ValidationError, AppError } from "../src/errors.js";
import fs from "fs";
import path from "path";
import os from "os";

let db: TaskflowDB;
let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskflow-tools-test-"));
  db = new TaskflowDB(path.join(tmpDir, "test.db"));
});

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Error hierarchy ──────────────────────────────────────────

describe("Error hierarchy", () => {
  it("NotFoundError has code NOT_FOUND", () => {
    const err = new NotFoundError("Project", 42);
    assert.equal(err.code, "NOT_FOUND");
    assert.equal(err.name, "NotFoundError");
    assert.match(err.message, /Project with id 42 not found/);
  });

  it("ValidationError has code VALIDATION_ERROR", () => {
    const err = new ValidationError("bad input");
    assert.equal(err.code, "VALIDATION_ERROR");
    assert.equal(err.name, "ValidationError");
  });

  it("NotFoundError and ValidationError extend AppError", () => {
    assert.ok(new NotFoundError("X", 1) instanceof AppError);
    assert.ok(new ValidationError("x") instanceof AppError);
  });

  it("Custom errors are instanceof Error", () => {
    assert.ok(new NotFoundError("X", 1) instanceof Error);
    assert.ok(new ValidationError("x") instanceof Error);
  });
});

// ── Database throws correct custom errors ────────────────────

describe("Database custom error integration", () => {
  it("createTask throws NotFoundError for nonexistent project", () => {
    assert.throws(
      () => db.createTask(99999, "Bad task"),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        assert.equal((err as NotFoundError).code, "NOT_FOUND");
        return true;
      }
    );
  });

  it("logTime throws NotFoundError for nonexistent task", () => {
    assert.throws(
      () => db.logTime(99999, 10),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        assert.equal((err as NotFoundError).code, "NOT_FOUND");
        return true;
      }
    );
  });

  it("tagTask throws NotFoundError for nonexistent task", () => {
    assert.throws(
      () => db.tagTask(99999, "oops"),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        return true;
      }
    );
  });

  it("addNote throws ValidationError when no project_id or task_id", () => {
    assert.throws(
      () => db.addNote("orphan note"),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.equal((err as ValidationError).code, "VALIDATION_ERROR");
        return true;
      }
    );
  });

  it("addNote throws NotFoundError for nonexistent project", () => {
    assert.throws(
      () => db.addNote("bad note", { project_id: 99999 }),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        return true;
      }
    );
  });

  it("addNote throws NotFoundError for nonexistent task", () => {
    assert.throws(
      () => db.addNote("bad note", { task_id: 99999 }),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        return true;
      }
    );
  });

  it("getTimeReport throws NotFoundError for nonexistent project", () => {
    assert.throws(
      () => db.getTimeReport(99999),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        return true;
      }
    );
  });

  it("exportProject throws NotFoundError for nonexistent project", () => {
    assert.throws(
      () => db.exportProject(99999),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        return true;
      }
    );
  });
});

// ── JSON serialization ───────────────────────────────────────

describe("JSON serialization", () => {
  it("produces 2-space indented output", () => {
    const data = { name: "test", value: 42 };
    const result = JSON.stringify(data, null, 2);
    assert.ok(result.includes("  "));
    assert.equal(result, '{\n  "name": "test",\n  "value": 42\n}');
  });
});
