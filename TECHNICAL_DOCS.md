# Technical Documentation: mcp-taskflow

---

## 1. What This Project Does

### Plain English Explanation

Imagine you have an incredibly smart assistant (that would be Claude, the AI) who can read your files, write code, and answer questions. Now imagine you want that assistant to also *manage your projects* -- keep track of what you are working on, what is done, what is overdue, and how much time you have spent. But there is a problem: Claude lives in a chat window. It does not have a project management database. It cannot remember your tasks between conversations.

**mcp-taskflow** solves that problem. It is a small server that sits between Claude and a local database on your computer. When you say "Create a project called Website Redesign and add three tasks," Claude calls mcp-taskflow, which stores everything in a SQLite database file on your machine. The next time you ask "What is overdue?", Claude queries that same database and gives you an answer based on real, persistent data.

Think of it like this: Claude is the brain, and mcp-taskflow is the notebook it writes in so it does not forget.

### What Problem It Solves

AI assistants are stateless by default -- every conversation starts from scratch. mcp-taskflow gives Claude a *persistent memory* for project management. Instead of you maintaining a spreadsheet or paying for a SaaS tool, your AI assistant manages it all through natural conversation, and the data stays on your computer.

### Who Would Use It and Why

- **Developers** who want to track their side projects, sprint tasks, and time without leaving the terminal.
- **Freelancers** who want a simple time-tracking and project-overview tool they can query conversationally.
- **Anyone learning MCP** who wants a real, full-featured example of how to build an MCP server with tools, resources, and prompts.

### How It Fits into the Claude/MCP Ecosystem

The Model Context Protocol (MCP) is Anthropic's standard for connecting AI assistants to external capabilities. mcp-taskflow is an **MCP server** -- a program that exposes structured operations (tools, resources, prompts) that any MCP-compatible client (Claude Code, Claude Desktop) can discover and invoke. It is one of many possible MCP servers; others might connect to GitHub, Slack, or a weather API. mcp-taskflow connects Claude to a local project management database.

---

## 2. How MCP (Model Context Protocol) Works

### What Is MCP in Simple Terms

Think of MCP like a **USB port for AI**. Just as USB lets you plug any device (keyboard, camera, hard drive) into any computer without special drivers, MCP lets you plug any capability (database access, web search, file management) into any AI assistant that speaks the protocol.

Without MCP, giving Claude access to a database would require custom code for every integration. With MCP, you build one server, and any MCP client can use it immediately.

### The 3 Capabilities

MCP servers can expose three types of capabilities. mcp-taskflow uses all three:

#### Tools (like giving the AI a Swiss Army knife)

Tools are **actions** the AI can perform. Each tool has a name, a description, and a defined set of inputs and outputs. When Claude decides it needs to create a task, it calls the `create_task` tool with the appropriate parameters, and gets structured JSON back.

**Real-world analogy:** Tools are like apps on your phone. Each one does a specific thing (calculator, camera, calendar), takes specific input, and gives specific output. mcp-taskflow provides 20 tools -- think of them as 20 specialized apps Claude can use.

#### Resources (like giving the AI a bookshelf to browse)

Resources are **data the AI can read**. They have URIs (like web addresses) and return structured content. Unlike tools, resources are passive -- they do not change anything, they just provide information.

**Real-world analogy:** If tools are like apps, resources are like documents in a filing cabinet. Claude can open the "dashboard" document to see an overview, or open "project/3" to read everything about project number 3. The `project` resource even supports a `list` operation, so Claude can browse which projects exist -- like looking at the labels on the filing cabinet drawers.

#### Prompts (like giving the AI recipe cards)

Prompts are **pre-built templates** that combine live data with specific instructions. When Claude uses the `weekly_report` prompt, mcp-taskflow gathers all current project data and wraps it in a carefully crafted instruction that tells Claude exactly how to format a professional weekly status report.

**Real-world analogy:** Prompts are like recipe cards. The ingredients (your project data) change, but the recipe (the report format and structure) stays the same. You get a consistent, well-structured output every time.

### How Claude Connects to MCP Servers

```
┌─────────────────┐         ┌──────────────────┐
│   Claude Code   │  stdio  │  mcp-taskflow    │
│  or Claude      │◄───────►│  server          │
│  Desktop        │ JSON-RPC│  (Node.js)       │
└─────────────────┘         └──────────────────┘
```

1. When Claude Code or Claude Desktop starts, it reads its configuration file and sees that mcp-taskflow is registered.
2. It launches the mcp-taskflow process (runs `node dist/index.js`).
3. The two communicate over **stdio** (standard input/output) -- the same pipes that normally carry text in a terminal. The client writes JSON to the server's stdin, and reads JSON from the server's stdout.
4. The messages follow the **JSON-RPC 2.0** format -- a simple standard for remote procedure calls. Each message has a method name, parameters, and an ID for matching requests to responses.

### The JSON-RPC Communication Over stdio

Here is what a typical exchange looks like under the hood (you never see this -- it is handled automatically):

**Client sends (to create a project):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "create_project",
    "arguments": {
      "name": "Website Redesign",
      "description": "Complete overhaul of the company site"
    }
  }
}
```

**Server responds:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{ \"id\": 1, \"name\": \"Website Redesign\", ... }"
    }]
  }
}
```

Why stdio instead of HTTP? Because MCP servers are typically local processes, not remote web services. stdio is simpler, faster, and requires no port management or network configuration.

---

## 3. System Architecture

### Component Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                        MCP Client                              │
│              (Claude Code / Claude Desktop)                     │
│                                                                │
│   User says: "Create a project called Website Redesign"        │
│   Claude decides to call the create_project tool               │
└───────────────────────┬────────────────────────────────────────┘
                        │
                        │ stdio (JSON-RPC 2.0)
                        │
┌───────────────────────▼────────────────────────────────────────┐
│                   index.ts (Entry Point)                        │
│                                                                │
│   Creates: McpServer, TaskflowDB                               │
│   Wires:   registerTools(), registerResources(), registerPrompts│
│   Starts:  StdioServerTransport                                │
│                                                                │
│   ┌──────────────┐   ┌───────────────┐   ┌───────────────┐    │
│   │   tools.ts   │   │ resources.ts  │   │  prompts.ts   │    │
│   │              │   │               │   │               │    │
│   │ 20 tools     │   │ 3 resources   │   │ 3 prompts     │    │
│   │ Zod schemas  │   │ dashboard     │   │ daily_standup │    │
│   │ withLogging  │   │ project/{id}  │   │ weekly_report │    │
│   │              │   │ task/{id}     │   │ plan_project  │    │
│   └──────┬───────┘   └──────┬────────┘   └──────┬────────┘    │
│          │                  │                    │             │
│          └──────────────────┼────────────────────┘             │
│                             │                                  │
│                             ▼                                  │
│   ┌─────────────────────────────────────────────────────┐      │
│   │              database.ts (TaskflowDB)               │      │
│   │                                                     │      │
│   │  - Schema migrations (versioned, append-only)       │      │
│   │  - CRUD for projects, tasks, tags, time, notes      │      │
│   │  - Search, dashboard, export                        │      │
│   │  - Helper: buildUpdate(), fetchTasksWithDetails()   │      │
│   └────────────────────────┬────────────────────────────┘      │
│                            │                                   │
│   ┌────────────────────────▼────────────────────────────┐      │
│   │          SQLite (better-sqlite3)                    │      │
│   │                                                     │      │
│   │  - WAL mode (concurrent reads)                      │      │
│   │  - Foreign keys ON (cascade deletes)                │      │
│   │  - File: ~/.mcp-taskflow/taskflow.db                │      │
│   └─────────────────────────────────────────────────────┘      │
│                                                                │
│   Supporting modules:                                          │
│   ┌──────────┐  ┌───────────┐  ┌───────────┐                  │
│   │ types.ts │  │ errors.ts │  │ logger.ts │                  │
│   │          │  │           │  │           │                  │
│   │ TS types │  │ AppError  │  │ JSON logs │                  │
│   │ enums    │  │ NotFound  │  │ to stderr │                  │
│   │          │  │ Validate  │  │ tool perf │                  │
│   │          │  │ Conflict  │  │           │                  │
│   └──────────┘  └───────────┘  └───────────┘                  │
└────────────────────────────────────────────────────────────────┘
```

### How a Request Flows

Let us trace what happens when a user says "Create a project called Website Redesign":

1. **Claude (the AI)** decides it needs to call the `create_project` tool with `{ name: "Website Redesign" }`.
2. **The MCP client** (Claude Code or Claude Desktop) sends a JSON-RPC message over stdio to the mcp-taskflow process.
3. **The MCP SDK** inside mcp-taskflow receives the message, validates it, and routes it to the correct tool handler registered in `tools.ts`.
4. **The tool handler** in `tools.ts` validates the input using a Zod schema (ensures `name` is a non-empty string), then calls `db.createProject("Website Redesign")`.
5. **The `withLogging` wrapper** times the operation and will log the result.
6. **The `TaskflowDB` class** in `database.ts` runs an INSERT query against SQLite, then immediately SELECTs the new row to return the complete project object.
7. **SQLite** writes the data to `~/.mcp-taskflow/taskflow.db` on disk.
8. **The tool handler** wraps the project object in a JSON response with `{ content: [{ type: "text", text: "..." }] }`.
9. **The logger** writes a structured JSON log entry to stderr (tool name, arguments, duration, success).
10. **The MCP SDK** sends the JSON-RPC response back over stdio to the client.
11. **Claude** reads the response and tells the user: "I have created the project 'Website Redesign'."

### Each Module's Role

| Module | Role | Analogy |
|--------|------|---------|
| `index.ts` | Wires everything together and starts the server | The power button and wiring in a machine |
| `types.ts` | Defines the shape of all data structures | The blueprints |
| `database.ts` | All database operations: queries, migrations, data access | The engine |
| `tools.ts` | Registers 20 MCP tools with input validation | The control panel with 20 buttons |
| `resources.ts` | Registers 3 browsable data resources | The display screens showing live data |
| `prompts.ts` | Registers 3 prompt templates using live data | The report templates |
| `errors.ts` | Custom error types for consistent error handling | The warning labels |
| `logger.ts` | Structured JSON logging to stderr | The flight recorder |

### Why This Architecture

**Trade-off: Single file vs. split modules.** We split into 8 files instead of one large file. This makes each file small enough to understand in one sitting, and allows a developer to work on tools without touching the database layer. The cost is more imports and a slightly higher entry barrier.

**Trade-off: Singleton DB class vs. per-request connections.** We create one database connection when the server starts and reuse it for all requests. This is simpler and faster than opening/closing connections per request. The downside is that you cannot easily run multiple server instances against the same database file, but that is not a use case for a personal project management tool.

**Trade-off: SQLite vs. PostgreSQL.** SQLite means zero setup -- no database server to install, no connection strings, no accounts. The data is just a file on your computer. The limitation is that it does not scale to multiple concurrent writers, but an MCP server serving one user does not need that.

---

## 4. Database Design

### Entity-Relationship Diagram

```
┌───────────────────┐       ┌───────────────────────┐
│     projects      │       │        tasks           │
├───────────────────┤       ├───────────────────────┤
│ id (PK)           │───┐   │ id (PK)               │
│ name (UNIQUE)     │   │   │ project_id (FK) ──────┤───┐
│ description       │   └──►│ title                 │   │
│ status            │       │ description           │   │
│ created_at        │       │ status                │   │
│ updated_at        │       │ priority              │   │
└───────┬───────────┘       │ due_date              │   │
        │                   │ completed_at          │   │
        │                   │ created_at            │   │
        │                   │ updated_at            │   │
        │                   └──┬──────────┬─────────┘   │
        │                      │          │             │
        │    ┌─────────────────┘          │             │
        │    │                            │             │
        │    │    ┌───────────────────┐   │             │
        │    │    │   time_entries    │   │             │
        │    │    ├───────────────────┤   │             │
        │    │    │ id (PK)          │   │             │
        │    │    │ task_id (FK) ────┤───┘             │
        │    │    │ description      │                 │
        │    │    │ minutes          │                 │
        │    │    │ logged_at        │                 │
        │    │    └───────────────────┘                 │
        │    │                                          │
        │    │    ┌───────────────────┐                 │
        │    │    │   task_tags       │                 │
        │    │    │  (junction table) │                 │
        │    │    ├───────────────────┤                 │
        │    │    │ task_id (FK) ────┤─────────────────┘
        │    │    │ tag_id (FK) ─────┤──┐
        │    │    │ (composite PK)   │  │
        │    │    └───────────────────┘  │
        │    │                           │
        │    │    ┌───────────────────┐  │
        │    │    │      tags        │  │
        │    │    ├───────────────────┤  │
        │    │    │ id (PK)          │◄─┘
        │    │    │ name (UNIQUE,    │
        │    │    │       NOCASE)    │
        │    │    │ color            │
        │    │    └───────────────────┘
        │    │
        │    │    ┌───────────────────┐
        │    │    │      notes       │
        │    │    ├───────────────────┤
        ├────┼───►│ project_id (FK)  │
             └───►│ task_id (FK)     │
                  │ id (PK)          │
                  │ content          │
                  │ created_at       │
                  └───────────────────┘

One project has many tasks.
One task has many time entries.
One task has many tags (via task_tags). One tag has many tasks.
Notes can belong to a project, a task, or both.
Deleting a project cascades to all its tasks, notes, time entries, and tag associations.
```

### Every Table Explained

#### `projects`

**What it stores:** Top-level containers for organizing work. A project might be "Website Redesign" or "Mobile App v2".

**Why it exists:** Everything else lives inside a project. Without projects, tasks would be a flat, unorganized list.

**Key columns:**
- `name` (UNIQUE) -- No two projects can have the same name. This prevents accidental duplicates.
- `status` -- One of `active`, `paused`, `completed`, `archived`. Constrained by a CHECK clause so invalid values are rejected at the database level, not just in application code.
- `created_at`, `updated_at` -- Automatically set using SQLite's `datetime('now')` default.

#### `tasks`

**What it stores:** Individual work items within a project. "Implement auth flow" or "Design the settings screen."

**Why it exists:** Tasks are the core unit of work. They have a lifecycle (todo -> in_progress -> review -> done) and attributes like priority and due date.

**Key columns:**
- `project_id` (FOREIGN KEY) -- Links to the parent project. `ON DELETE CASCADE` means deleting a project automatically deletes all its tasks.
- `priority` -- One of `low`, `medium`, `high`, `urgent`. Enforced by CHECK constraint.
- `status` -- One of `todo`, `in_progress`, `review`, `done`, `blocked`. Enforced by CHECK constraint.
- `completed_at` -- Automatically set when status changes to `done`, automatically cleared when status changes away from `done`. This is handled in application code (`updateTask`), not by a database trigger.
- `due_date` -- Optional. Stored as text in YYYY-MM-DD format for easy date comparison in SQL.

#### `time_entries`

**What it stores:** Records of time spent on tasks. "30 minutes working on tests."

**Why it exists:** Time tracking lets you answer questions like "How much time did I spend on the Mobile App project this week?"

**Key columns:**
- `task_id` (FOREIGN KEY) -- Links to the task this time was logged against. Cascades on delete.
- `minutes` -- Must be greater than 0 (enforced by CHECK constraint). Stored as integer minutes rather than hours for precision without floating-point issues.
- `logged_at` -- When the entry was recorded. Defaults to now but could be set to a past date.

#### `notes`

**What it stores:** Free-form text (supports markdown) attached to projects or tasks.

**Why it exists:** Not everything fits in a task title or description. Notes let you capture meeting summaries, design decisions, research findings, and similar content.

**Key columns:**
- `project_id` (FOREIGN KEY, nullable) -- If set, the note is attached to a project.
- `task_id` (FOREIGN KEY, nullable) -- If set, the note is attached to a task.
- At least one of these must be set (enforced in application code via `ValidationError`).

#### `tags`

**What it stores:** Labels for categorizing tasks. "frontend", "bug", "architecture".

**Why it exists:** Tags provide cross-cutting categorization. A task might be in the "Mobile App" project but tagged "frontend" and "bug". You can then search for all frontend bugs across all projects.

**Key columns:**
- `name` (UNIQUE, COLLATE NOCASE) -- Case-insensitive uniqueness. "Bug" and "bug" are treated as the same tag.
- `color` -- A hex color code for display purposes. Defaults to `#6B7280` (a neutral gray).

#### `task_tags`

**What it stores:** The relationship between tasks and tags. This is a **junction table** (also called a "join table" or "bridge table") that implements a many-to-many relationship.

**Why it exists:** One task can have many tags, and one tag can be on many tasks. Relational databases cannot store many-to-many relationships directly, so this table acts as the connector.

**Key columns:**
- `task_id` + `tag_id` (composite PRIMARY KEY) -- Each task-tag pair can exist only once.
- Both columns are foreign keys with `ON DELETE CASCADE`, so deleting a task removes its tag associations, and deleting a tag removes it from all tasks.

#### `schema_version`

**What it stores:** Which database migrations have been applied.

**Why it exists:** See the Schema Migrations section below.

### Schema Migrations: What They Are, Why They Matter, How Ours Work

#### What They Are

A schema migration is a versioned change to the database structure. Think of it like a recipe for evolving the database. Migration 1 might create the initial tables. Migration 2 might add a new column. Migration 3 might add an index.

#### Why They Matter

Without migrations, updating the database schema would mean either:
- Deleting the database and losing all data (unacceptable).
- Manually running SQL commands (error-prone and not reproducible).

Migrations give you a reliable, automated way to evolve the schema. When you start the server, it checks which migrations have been applied and runs any new ones. This works whether you are running the server for the first time (all migrations run) or upgrading from an older version (only new migrations run).

#### How Ours Work

```
1. Server starts
2. TaskflowDB constructor runs
3. this.migrate() is called
4. It creates the schema_version table if it does not exist
5. It reads all applied versions from schema_version
6. For each migration in the MIGRATIONS array:
   - If NOT already applied:
     - Run the migration SQL inside a transaction
     - Record the version in schema_version
   - If already applied:
     - Skip it
7. Database is ready
```

The `MIGRATIONS` array in `database.ts` is append-only. You never modify an existing migration. If you need to change the schema, you add a new migration at the end of the array. Here is the current structure:

```typescript
const MIGRATIONS: Array<{ version: number; up: string }> = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS projects ( ... );
      CREATE TABLE IF NOT EXISTS tasks ( ... );
      -- ... all initial tables and indexes
    `,
  },
  // Future migrations would go here:
  // { version: 2, up: `ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER;` },
];
```

### SQLite-Specific Choices

#### WAL Mode (Write-Ahead Logging)

```typescript
this.db.pragma("journal_mode = WAL");
```

**Plain English:** By default, SQLite locks the entire database file during writes, which blocks readers. WAL mode changes this: writes go to a separate log file first, and readers can continue reading the main database file simultaneously. It is like having a "draft pad" where changes are written before being merged into the main document.

**Why we chose it:** While mcp-taskflow is single-user, WAL mode provides slightly better performance for the pattern of "write something, then immediately read it back" that our tool handlers use constantly.

#### Foreign Keys

```typescript
this.db.pragma("foreign_keys = ON");
```

**Plain English:** Foreign keys are not enforced by default in SQLite (for historical compatibility reasons). This pragma turns enforcement on, which means the database will reject any operation that would create an orphaned record (like adding a task to a project that does not exist) and will automatically cascade deletes (like removing all tasks when a project is deleted).

**Why we chose it:** Data integrity. Without foreign keys, you could delete a project and leave its tasks floating in the database with no parent. With `ON DELETE CASCADE`, the database handles cleanup automatically.

#### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority  ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date  ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_time_task       ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_logged     ON time_entries(logged_at);
CREATE INDEX IF NOT EXISTS idx_notes_project   ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_task      ON notes(task_id);
```

**Plain English:** An index is like the index at the back of a book. Without it, finding all tasks with status "urgent" would require scanning every row in the tasks table. With an index on the `status` column, the database can jump directly to the relevant rows.

**Why we chose these specific indexes:** Each index matches a common query pattern. We index `tasks.project_id` because listing tasks by project is the most common operation. We index `time_entries.logged_at` because time reports filter by date range. We do not index every column because indexes cost disk space and slow down writes.

### Example Queries with Explanations

**Getting a task with all its details (tags, time, project name):**

```sql
SELECT t.*, p.name as project_name,
       COALESCE((SELECT SUM(minutes) FROM time_entries WHERE task_id = t.id), 0) as total_minutes,
       GROUP_CONCAT(DISTINCT tg.name) as tag_list
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN task_tags tt ON tt.task_id = t.id
LEFT JOIN tags tg ON tg.id = tt.tag_id
WHERE t.id = ?
GROUP BY t.id
```

Breaking this down:
- `JOIN projects p` -- Get the project name for this task.
- `LEFT JOIN task_tags tt` and `LEFT JOIN tags tg` -- Get all tags. LEFT JOIN means tasks without tags still appear (they just have NULL for tag columns).
- `GROUP_CONCAT(DISTINCT tg.name)` -- Combine all tag names into a comma-separated string like "bug,frontend". The application code then splits this into an array.
- `COALESCE(SUM(minutes), 0)` -- Add up all time entries. COALESCE converts NULL (no time entries) to 0.
- `GROUP BY t.id` -- Because we are aggregating tags and time, we group by the task.

**Dashboard: getting urgent tasks that are not done:**

```sql
SELECT ... FROM tasks t
WHERE t.priority = 'urgent' AND t.status NOT IN ('done')
ORDER BY t.created_at ASC LIMIT 10
```

This finds the oldest urgent tasks that still need attention. Oldest first (ASC) because those are the ones that have been waiting longest.

---

## 5. Code Walkthrough

### `src/index.ts` -- The Entry Point

**What it does:** Creates the server, connects the pieces, and starts listening for requests. It is the "main" function of the application.

**Key elements:**

- **Server creation:** `new McpServer({ name: "mcp-taskflow", version: "1.0.0" })` creates an MCP server instance with metadata that clients can use to identify it.
- **Database creation:** `new TaskflowDB()` opens the database (creating the file and running migrations if needed).
- **Registration:** Three function calls wire up all tools, resources, and prompts. This pattern keeps index.ts clean -- it does not need to know the details of each tool.
- **Transport:** `new StdioServerTransport()` tells the MCP SDK to communicate over stdin/stdout. Other transports exist (like SSE for web) but stdio is standard for CLI tools.
- **Graceful shutdown:** The `SIGINT` and `SIGTERM` handlers ensure the database connection is closed cleanly when the process is terminated. This is important because SQLite WAL mode uses a write-ahead log that needs proper cleanup.

**Design decision:** The entry point is intentionally minimal (40 lines). All logic lives in other modules. This makes testing easier -- you can test the database, tools, and resources independently without starting the full server.

### `src/types.ts` -- TypeScript Interfaces

**What it does:** Defines the shape of every data structure in the system. No logic, just type definitions.

**Key types:**

- **Enum-like types:** `ProjectStatus`, `TaskStatus`, `TaskPriority` are union types that restrict values to specific strings. The corresponding arrays (`PROJECT_STATUSES`, etc.) allow runtime validation.
- **Row types:** `Project`, `Task`, `TimeEntry`, `Note`, `Tag` mirror the database tables exactly. This means database query results can be cast directly to these types.
- **`TaskWithDetails`:** Extends `Task` with extra fields (`project_name`, `tags`, `total_minutes`) that come from JOIN queries. This is the type used in most tool responses because it gives Claude all the context it needs in one object.
- **Composite types:** `Dashboard`, `TimeReport`, `SearchResult`, `ProjectExport` are assembled from multiple queries. They represent the complex responses that tools and resources return.

**How it connects:** Every other file imports from types.ts. It is the shared vocabulary of the codebase.

**Design decision:** Types are in a separate file rather than co-located with the code that uses them because multiple modules need the same types. `database.ts` returns `Project` objects, `tools.ts` serializes them, and `resources.ts` renders them.

### `src/database.ts` -- The Database Layer

**What it does:** Contains all database operations as methods on the `TaskflowDB` class. This is the largest and most important file in the project (~780 lines).

**Key elements:**

- **Constructor:** Accepts an optional `dbPath` parameter. If not provided, it checks the `TASKFLOW_DB_PATH` environment variable, then falls back to `~/.mcp-taskflow/taskflow.db`. This three-level fallback gives flexibility for testing, custom deployments, and the default case.

- **`migrate()`:** Runs schema migrations (described in detail in Section 4). Called once in the constructor.

- **CRUD methods for each entity:**
  - `createProject()`, `getProject()`, `listProjects()`, `updateProject()`, `deleteProject()`
  - `createTask()`, `getTask()`, `getTaskWithDetails()`, `listTasks()`, `updateTask()`, `deleteTask()`
  - `createTag()`, `listAllTags()`, `tagTask()`, `untagTask()`, `getTaskTags()`, `deleteTag()`
  - `logTime()`, `getTimeReport()`
  - `addNote()`, `listNotes()`, `deleteNote()`

- **`buildUpdate()`:** A private helper that dynamically constructs UPDATE SQL from a partial object. Instead of writing separate update methods for "update name", "update status", "update name and status", it builds the SET clause from whichever fields are present. This is a pragmatic choice that avoids dozens of nearly identical methods.

- **`fetchTasksWithDetails()`:** A private helper that runs the complex "task with tags and time" query with a dynamic WHERE clause. Used by the dashboard to get urgent tasks, overdue tasks, and recently completed tasks without duplicating the JOIN logic.

- **`createTask()` with tags:** When tags are passed to `createTask()`, it calls `tagTask()` for each one inside the same method. This means a single tool call can create a task *and* tag it in one step, which feels natural in conversation ("Add a high-priority task tagged 'frontend'").

- **`updateTask()` with `completed_at` logic:** When a task's status changes to `done`, the method automatically sets `completed_at` to the current timestamp. When it changes away from `done`, it clears `completed_at`. This is application-level logic rather than a database trigger -- a deliberate choice to keep all behavior visible in TypeScript rather than hidden in SQL.

**How it connects:** tools.ts, resources.ts, and prompts.ts all receive a `TaskflowDB` instance and call its methods.

### `src/tools.ts` -- MCP Tool Registrations

**What it does:** Registers all 20 MCP tools on the server, each with a Zod validation schema, a description for Claude, and a handler function.

**Key elements:**

- **Helper functions at the top:**
  - `json(data)` -- Pretty-prints data as JSON.
  - `ok(data)` -- Wraps data in the MCP content format for successful responses.
  - `err(msg)` -- Wraps an error message in the MCP content format with `isError: true`.

- **`withLogging()` wrapper:** Every tool handler is wrapped in this function. It starts a performance timer, runs the handler, logs the result (success or failure), and catches any thrown errors to return them as user-friendly error messages rather than crashing the server. This is a cross-cutting concern handled once rather than duplicated in every tool.

- **Zod schemas:** Each tool's inputs are validated with Zod before the handler runs. For example, `create_task` validates that `project_id` is a number, `title` is a non-empty string, `priority` is one of the four valid values, and `due_date` matches the `YYYY-MM-DD` regex. If validation fails, the MCP SDK returns an error to Claude before our code even runs.

- **Schema descriptions:** Every Zod field has a `.describe()` call. These descriptions are sent to Claude as part of the tool schema, helping it understand what each parameter is for. For example, `z.string().min(1).describe("Unique project name")` tells Claude both the type constraint and the semantic meaning.

**How it connects:** Receives the `McpServer` and `TaskflowDB` instances from index.ts. Calls database methods and wraps results in MCP response format. Uses logger.ts for structured logging.

**Design decision:** All 20 tools are registered in a single function rather than 20 separate files. This works because each registration is concise (10-20 lines) and they share the helper functions at the top. At 355 lines, the file is manageable. If the project grew to 50+ tools, splitting into tool groups (projectTools.ts, taskTools.ts, etc.) would make sense.

### `src/resources.ts` -- MCP Resource Definitions

**What it does:** Registers 3 MCP resources that expose data Claude can browse.

**Key elements:**

- **`taskflow://dashboard`** (static resource) -- Returns the same dashboard data as the `dashboard` tool, but as a browsable resource. Clients can display this as a "document" rather than a tool result.

- **`taskflow://project/{projectId}`** (template resource with list) -- Uses `ResourceTemplate` to define a parameterized URI. The `list` callback returns all projects, allowing clients to discover which projects exist. When accessed with a specific ID, it returns the full project export.

- **`taskflow://task/{taskId}`** (template resource without list) -- Similar to the project resource but for individual tasks. The `list` is undefined because listing all tasks globally does not make sense (there could be thousands). Tasks are discovered through projects instead.

**How it connects:** Receives the `McpServer` and `TaskflowDB` instances from index.ts. Calls database methods and wraps results as resource contents.

**Design decision:** Resources return the same data as tools in many cases. This is intentional -- tools and resources serve different purposes. A tool is something Claude calls to *do* something. A resource is something a client can *browse*. Having both means the data is accessible in whatever way the client prefers.

### `src/prompts.ts` -- MCP Prompt Templates

**What it does:** Registers 3 prompt templates that combine live project data with carefully crafted instructions.

**Key elements:**

- **`daily_standup`:** Gathers dashboard data and asks Claude to format it as a standup report with four sections: completed, in progress, blockers, and time logged.

- **`weekly_report`:** Goes further than the standup -- it exports full details for every active project and asks for a professional status report with summary, project updates, time investment, risks, and next-week priorities.

- **`plan_project`:** Takes a `project_id` parameter, exports that project's complete data, and asks Claude to analyze what work is missing, suggest priority changes, estimate time based on historical data, and recommend tags. If the project does not exist, it gracefully returns the list of available projects instead of crashing.

**How it connects:** Receives the `McpServer` and `TaskflowDB` instances from index.ts. The `plan_project` prompt uses Zod for parameter validation (the project_id must be a string -- MCP prompt parameters are always strings).

**Design decision:** Prompts embed data *and* instructions in a single user message. An alternative would be to use system messages, but user messages are more portable across different MCP clients.

### `src/errors.ts` -- Custom Error Hierarchy

**What it does:** Defines three custom error classes that extend a common `AppError` base class.

**Key elements:**

- **`AppError`** -- Base class. Adds a `code` property (like "NOT_FOUND" or "VALIDATION_ERROR") to the standard JavaScript `Error`. The code makes it easy for tool handlers to identify error types without using `instanceof` checks.

- **`NotFoundError`** -- For when a requested entity does not exist. Constructor takes an entity name and ID, producing messages like "Project with id 42 not found".

- **`ValidationError`** -- For invalid input that passes Zod validation but fails business rules (like a note without both project_id and task_id).

- **`ConflictError`** -- For uniqueness violations. Currently used implicitly when SQLite's UNIQUE constraint fires on duplicate project names.

**How it connects:** database.ts throws these errors. tools.ts catches them via the `withLogging` wrapper and converts them to user-friendly MCP error responses.

### `src/logger.ts` -- Structured Logging

**What it does:** Provides two logging functions that write structured JSON to stderr.

**Key elements:**

- **`log()`** -- General-purpose logging with level (info/warn/error), message, and optional data.

- **`toolLog()`** -- Specialized logging for tool calls. Records the tool name, sanitized arguments, execution duration in milliseconds, and success/failure status.

- **`sanitizeArgs()`** -- Truncates string arguments longer than 200 characters before logging. This prevents enormous note contents from flooding the logs.

**How it connects:** Imported by tools.ts and used in the `withLogging` wrapper. Every tool call is automatically logged.

**Design decision:** Logs go to stderr, not stdout. This is critical because stdout is reserved for MCP JSON-RPC communication. If logs went to stdout, they would corrupt the protocol stream and break everything. stderr is the standard channel for diagnostic output in Unix-style programs.

---

## 6. Error Handling Strategy

### The Error Hierarchy

```
Error (built-in JavaScript)
  └── AppError (code: string)
        ├── NotFoundError (code: "NOT_FOUND")
        ├── ValidationError (code: "VALIDATION_ERROR")
        └── ConflictError (code: "CONFLICT")
```

Every custom error carries both a human-readable `message` and a machine-readable `code`. The `message` is what Claude shows to the user. The `code` is what application logic can check programmatically.

### How Errors Flow

```
┌──────────────┐    throws     ┌──────────────────┐    catches     ┌─────────────┐
│  database.ts │ ─────────────►│ withLogging()    │ ──────────────►│ MCP response│
│              │  NotFoundError │ in tools.ts      │  err() helper  │ isError:true│
│ db.logTime   │               │                  │                │             │
│ (99999, 10)  │               │ catches any      │                │ "Failed:    │
│              │               │ error, logs it,  │                │  Task with  │
│              │               │ returns err()    │                │  id 99999   │
│              │               │                  │                │  not found" │
└──────────────┘               └──────────────────┘                └──────┬──────┘
                                                                         │
                                                                         ▼
                                                                 ┌──────────────┐
                                                                 │   Claude      │
                                                                 │ tells user:  │
                                                                 │ "That task   │
                                                                 │  doesn't     │
                                                                 │  exist."     │
                                                                 └──────────────┘
```

Step by step:

1. The database layer detects the problem and throws a specific error (e.g., `throw new NotFoundError("Task", 99999)`).
2. The `withLogging` wrapper in tools.ts catches *all* errors, logs them with timing data, and converts them to MCP error responses using `err(e.message)`.
3. The MCP SDK sends the error response back to the client with `isError: true`.
4. Claude reads the error and formulates a natural-language explanation for the user.

### Why We Chose This Approach

**Errors never crash the server.** The `withLogging` wrapper acts as a safety net. Even if the database throws an unexpected error (like a disk full error), the server stays running and returns a meaningful message instead of dying.

**Errors are typed.** Using `NotFoundError` vs `ValidationError` vs `ConflictError` makes the code self-documenting. When you read `throw new NotFoundError("Project", id)`, you immediately understand what went wrong.

**Errors flow one way.** Database -> tool handler -> MCP response -> Claude. There is no complex error recovery or retry logic. This simplicity makes the system predictable and easy to debug.

---

## 7. Logging & Observability

### What Gets Logged and Why

Every tool invocation is logged with:
- **Tool name** -- Which tool was called (e.g., "create_project").
- **Arguments** -- What parameters were passed (truncated if long).
- **Duration** -- How many milliseconds the operation took.
- **Success/failure** -- Whether it completed without errors.
- **Error message** -- If it failed, what went wrong.

This gives you a complete audit trail of every action Claude takes through the server.

### The Structured JSON Format

```json
{
  "timestamp": "2026-04-03T14:30:00.000Z",
  "level": "info",
  "message": "tool:create_project",
  "tool": "create_project",
  "args": {
    "name": "Website Redesign",
    "description": "Complete overhaul"
  },
  "durationMs": 3,
  "success": true
}
```

For failures:
```json
{
  "timestamp": "2026-04-03T14:30:00.000Z",
  "level": "error",
  "message": "tool:log_time",
  "tool": "log_time",
  "args": { "task_id": 99999, "minutes": 30 },
  "durationMs": 1,
  "success": false,
  "error": "Task with id 99999 not found"
}
```

**Why JSON?** Because structured logs can be parsed by tools. You can pipe them through `jq` to filter, aggregate, or visualize. Plain text logs require regex parsing, which is fragile.

### How to Use Logs for Debugging

Since logs go to stderr, you can capture them when running the server:

```bash
# Run the server and save logs to a file
node dist/index.js 2>taskflow.log

# Watch logs in real time
tail -f taskflow.log

# Find all failed tool calls
cat taskflow.log | jq 'select(.success == false)'

# Find slow operations (over 100ms)
cat taskflow.log | jq 'select(.durationMs > 100)'

# Count calls per tool
cat taskflow.log | jq -r '.tool' | sort | uniq -c | sort -rn
```

When MCP clients like Claude Code run the server, stderr output typically appears in the client's debug logs or diagnostic panel.

---

## 8. Testing Strategy

### What Is Tested and Why

The project has **50 tests** across two test files:

#### `tests/database.test.ts` (37 tests)

Tests every database operation directly, organized by feature area:

| Area | Tests | What They Verify |
|------|-------|-----------------|
| Projects | 7 | Create, list, filter, update, delete, duplicate rejection, non-existent update |
| Tasks | 8 | Create with defaults, create with all options, list, filter by status, filter by tag, auto-complete timestamp, un-complete, delete |
| Tags | 4 | List with counts, case insensitivity, untag, global delete |
| Time Tracking | 4 | Log time, reject non-existent task, time report, date range filter |
| Notes | 5 | Project note, task note, reject non-existent parent, list by project, delete |
| Search | 4 | Cross-type search, scoped search (tasks only, projects only), empty results |
| Dashboard | 1 | Returns correct structure with all expected fields |
| Export | 2 | Full project snapshot, reject non-existent project |
| Migrations | 1 | Idempotent -- reopening the DB does not error |

#### `tests/tools.test.ts` (13 tests)

Tests the error handling layer and tool integration:

| Area | Tests | What They Verify |
|------|-------|-----------------|
| Error hierarchy | 4 | NotFoundError has correct code and name, ValidationError has correct code, both extend AppError, both extend Error |
| Database error integration | 8 | createTask throws NotFoundError, logTime throws NotFoundError, tagTask throws NotFoundError, addNote throws ValidationError (no parent), addNote throws NotFoundError (bad project), addNote throws NotFoundError (bad task), getTimeReport throws NotFoundError, exportProject throws NotFoundError |
| JSON serialization | 1 | Produces 2-space indented output |

### How to Run Tests

```bash
# Run all tests
npm test

# This executes:
# tsx --test tests/database.test.ts tests/tools.test.ts
```

The `tsx` runner compiles TypeScript on-the-fly and uses Node.js's built-in test runner (no Jest or Mocha dependency needed).

### How to Add New Tests

1. Identify which test file your test belongs in:
   - Testing a database method? Add to `tests/database.test.ts`.
   - Testing error handling, tool behavior, or integration? Add to `tests/tools.test.ts`.

2. Add your test inside an existing `describe` block or create a new one:

```typescript
describe("Your Feature", () => {
  it("does the expected thing", () => {
    // Arrange
    const project = db.createProject("Test");

    // Act
    const result = db.someNewMethod(project.id);

    // Assert
    assert.equal(result.someField, expectedValue);
  });
});
```

3. Run `npm test` to verify.

### The Test Database Isolation Approach

Tests use a **temporary database** that is created fresh and destroyed after each test run:

```typescript
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskflow-test-"));
  dbPath = path.join(tmpDir, "test.db");
  db = new TaskflowDB(dbPath);
});

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

This approach means:
- Tests never touch the production database at `~/.mcp-taskflow/taskflow.db`.
- Tests are repeatable -- each run starts clean.
- No shared state between test files -- each file creates its own temp database.
- Cleanup is automatic -- the temp directory is deleted even if tests fail.

Note that within a single test file, tests *do* share state. The "Tasks" tests rely on projects created in the "Projects" tests. This is intentional -- it tests that features work together, not just in isolation. The trade-off is that test order matters within a file.

---

## 9. How to Add New Features

### Adding a New Database Table (with Migration)

**Example:** Adding a `milestones` table.

**Step 1: Define the type in `src/types.ts`.**

```typescript
export interface Milestone {
  id: number;
  project_id: number;
  title: string;
  target_date: string | null;
  completed: boolean;
  created_at: string;
}
```

**Step 2: Add a migration in `src/database.ts`.**

Append to the `MIGRATIONS` array (never modify existing migrations):

```typescript
const MIGRATIONS: Array<{ version: number; up: string }> = [
  { version: 1, up: `... existing migration ...` },
  {
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS milestones (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL,
        title       TEXT NOT NULL,
        target_date TEXT,
        completed   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
    `,
  },
];
```

**Step 3: Add CRUD methods to `TaskflowDB` class.**

```typescript
createMilestone(projectId: number, title: string, targetDate?: string): Milestone {
  if (!this.getProject(projectId)) throw new NotFoundError("Project", projectId);
  const stmt = this.db.prepare(
    "INSERT INTO milestones (project_id, title, target_date) VALUES (?, ?, ?)"
  );
  const result = stmt.run(projectId, title, targetDate ?? null);
  return this.db
    .prepare("SELECT * FROM milestones WHERE id = ?")
    .get(result.lastInsertRowid) as Milestone;
}
```

**Step 4: Add tests in `tests/database.test.ts`.**

**Step 5: Run `npm test` and `npm run build`.**

### Adding a New MCP Tool

**Example:** Adding a `list_milestones` tool.

**Step 1: Add the database method** (see above).

**Step 2: Register the tool in `src/tools.ts`.**

Add inside the `registerTools` function:

```typescript
server.tool(
  "list_milestones",
  "List milestones for a project, showing progress toward goals",
  {
    project_id: z.number().describe("Project ID"),
  },
  withLogging("list_milestones", async ({ project_id }) =>
    ok(db.listMilestones(project_id))
  )
);
```

Key points:
- The first argument is the tool name (snake_case by convention).
- The second argument is a description Claude uses to decide when to call the tool.
- The third argument is a Zod schema that validates inputs.
- The fourth argument is the handler, wrapped in `withLogging` for automatic performance logging and error handling.

**Step 3: Test it.** Run the server and ask Claude to list milestones, or add a test to `tests/tools.test.ts`.

### Adding a New MCP Resource

**Example:** Adding a `taskflow://milestones/{projectId}` resource.

In `src/resources.ts`, add inside the `registerResources` function:

```typescript
server.resource(
  "milestones",
  new ResourceTemplate("taskflow://milestones/{projectId}", {
    list: async () => ({
      resources: db.listProjects().map((p) => ({
        uri: `taskflow://milestones/${p.id}`,
        name: `${p.name} milestones`,
        mimeType: "application/json",
      })),
    }),
  }),
  async (uri, variables) => {
    const id = parseInt(variables.projectId as string, 10);
    const milestones = db.listMilestones(id);
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(milestones, null, 2),
      }],
    };
  }
);
```

Key points:
- The `list` callback lets clients discover available resources (which projects have milestones).
- The read callback handles the actual data retrieval.
- Always return valid JSON with proper mimeType.

### Adding a New MCP Prompt

**Example:** Adding a `milestone_review` prompt.

In `src/prompts.ts`, add inside the `registerPrompts` function:

```typescript
server.prompt(
  "milestone_review",
  "Review milestone progress and suggest adjustments",
  {
    project_id: z.string().describe("The project ID to review milestones for"),
  },
  async ({ project_id }) => {
    const id = parseInt(project_id, 10);
    const data = db.exportProject(id);
    const milestones = db.listMilestones(id);
    const context = JSON.stringify({ ...data, milestones }, null, 2);

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Review the following project and milestone data. For each milestone,
assess whether it is on track based on task completion rates and time logged.
Suggest date adjustments if needed.

Data:
${context}`,
        },
      }],
    };
  }
);
```

Key points:
- Prompt parameters are always strings (MCP protocol constraint), so you parse them inside the handler.
- Prompts return messages, not raw data. The message contains both the data and the instructions for Claude.
- Include enough context in the prompt for Claude to give a useful response.

---

## 10. Configuration & Deployment

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TASKFLOW_DB_PATH` | Full path to the SQLite database file | `~/.mcp-taskflow/taskflow.db` |

The database path is determined in this order of precedence:
1. Constructor argument (used in tests).
2. `TASKFLOW_DB_PATH` environment variable.
3. Default: `~/.mcp-taskflow/taskflow.db`.

### Database Location

The default database lives at:
- **macOS/Linux:** `~/.mcp-taskflow/taskflow.db`
- **Windows:** `C:\Users\<username>\.mcp-taskflow\taskflow.db`

The directory is created automatically if it does not exist. The database file is created automatically on first run. You do not need to set anything up manually.

**Backing up your data:** Simply copy the `taskflow.db` file. Since SQLite stores everything in a single file, backup is trivial. If the server is running, the WAL mode ensures the copy will be consistent.

### Setting Up with Claude Code

Add to your Claude Code MCP settings (typically `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "taskflow": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-taskflow/dist/index.js"]
    }
  }
}
```

Make sure to:
1. Use an absolute path (not relative).
2. Point to `dist/index.js` (the compiled JavaScript), not `src/index.ts`.
3. Run `npm run build` first to generate the `dist/` directory.

### Setting Up with Claude Desktop

Add to `claude_desktop_config.json` (location varies by OS):
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "taskflow": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-taskflow/dist/index.js"]
    }
  }
}
```

To use a custom database location, add an `env` field:

```json
{
  "mcpServers": {
    "taskflow": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-taskflow/dist/index.js"],
      "env": {
        "TASKFLOW_DB_PATH": "/path/to/my/custom/taskflow.db"
      }
    }
  }
}
```

### Troubleshooting Common Issues

#### "Server not found" or tools not appearing

- Verify the path in your config is absolute and correct.
- Run `node /path/to/mcp-taskflow/dist/index.js` directly in a terminal to check for startup errors.
- Make sure you ran `npm run build` after any code changes.

#### "Cannot find module" errors

- Run `npm install` in the project directory.
- Run `npm run build` to recompile.
- Check that `dist/index.js` exists.

#### Database errors

- Check file permissions on `~/.mcp-taskflow/`.
- If the database is corrupted, delete `taskflow.db` (you will lose data) and the server will recreate it on next start.
- Make sure only one instance of the server is running against the same database file.

#### Logs are empty or not appearing

- Logs go to stderr. If running the server directly, redirect stderr: `node dist/index.js 2>debug.log`.
- In Claude Code, check the MCP server logs panel.
- In Claude Desktop, check the application logs.

#### Tests fail after code changes

- Make sure all files compile: `npx tsc`.
- Make sure you did not modify an existing migration (append only).
- Check that your test temp directory has write permissions.

---

## 11. Glossary

**ASCII diagram** -- A diagram drawn using plain text characters like `|`, `-`, `+`, and `>`. Used in documentation because it works everywhere, no special tools needed.

**CASCADE (ON DELETE CASCADE)** -- A database rule that automatically deletes related records when a parent record is deleted. If you delete a project, all its tasks, notes, and time entries are automatically deleted too.

**CHECK constraint** -- A database rule that restricts what values a column can hold. For example, `CHECK(status IN ('active','paused'))` means the status column will only accept "active" or "paused".

**COLLATE NOCASE** -- A SQLite setting that makes text comparisons case-insensitive. With NOCASE, "Bug" and "bug" are considered equal.

**CommonJS** -- A module system for JavaScript (uses `require()` and `module.exports`). This project uses CommonJS (`"type": "commonjs"` in package.json) for broadest compatibility.

**CRUD** -- Create, Read, Update, Delete. The four basic operations for managing data.

**Entity-relationship (ER) diagram** -- A visual representation of database tables and how they relate to each other.

**Foreign key** -- A column that references another table's primary key. It creates a link between two tables (e.g., a task's `project_id` references a project's `id`).

**INDEX** -- A database optimization that speeds up queries on specific columns. Like an index in a book, it lets the database find rows without scanning the entire table.

**JSON-RPC** -- A protocol for remote procedure calls using JSON. A client sends a JSON request with a method name and parameters, and the server responds with a JSON result.

**Junction table** -- A table that connects two other tables in a many-to-many relationship. The `task_tags` table connects tasks and tags.

**MCP (Model Context Protocol)** -- Anthropic's open standard for connecting AI assistants to external tools, data sources, and capabilities.

**MCP Client** -- A program (like Claude Code or Claude Desktop) that connects to MCP servers and lets an AI use their capabilities.

**MCP Server** -- A program that exposes tools, resources, and/or prompts over the MCP protocol. mcp-taskflow is an MCP server.

**Migration** -- A versioned, incremental change to a database schema. Migrations allow you to evolve the database structure over time without losing data.

**Node.js** -- A JavaScript runtime that lets you run JavaScript outside a web browser. mcp-taskflow runs on Node.js.

**Pragma** -- A SQLite command that sets database configuration options. For example, `PRAGMA journal_mode = WAL` enables Write-Ahead Logging.

**Primary key (PK)** -- A column (or set of columns) that uniquely identifies each row in a table. Every row has a different primary key value.

**Resource (MCP)** -- A read-only data endpoint exposed by an MCP server. Resources have URIs and return structured content.

**SQLite** -- A lightweight, file-based relational database. Unlike PostgreSQL or MySQL, it does not need a separate server process. The entire database is a single file.

**stderr (standard error)** -- An output stream separate from stdout. Programs use it for diagnostic messages, logs, and errors. In mcp-taskflow, logs go to stderr so they do not interfere with the JSON-RPC protocol on stdout.

**stdin/stdout (standard input/output)** -- The default input and output streams for a process. MCP uses these for JSON-RPC communication between client and server.

**stdio transport** -- A communication method where the client and server exchange messages through stdin and stdout, without using a network.

**Tool (MCP)** -- An action an AI can perform, exposed by an MCP server. Each tool has a name, description, input schema, and handler.

**Prompt (MCP)** -- A pre-built template that combines live data with instructions, exposed by an MCP server. Prompts help AIs generate consistent, well-structured output.

**Transaction** -- A group of database operations that either all succeed or all fail. If any operation in the transaction fails, all changes are rolled back.

**TSX** -- A tool that runs TypeScript files directly without a separate compilation step. Used for development (`npm run dev`) and running tests.

**TypeScript** -- A programming language that adds static types to JavaScript. It catches many errors at compile time rather than runtime.

**UNIQUE constraint** -- A database rule that prevents duplicate values in a column. No two projects can have the same name.

**URI (Uniform Resource Identifier)** -- A string that identifies a resource. In mcp-taskflow, resources have URIs like `taskflow://project/3`.

**WAL mode (Write-Ahead Logging)** -- A SQLite journaling mode where changes are written to a separate log file before being merged into the main database. This allows concurrent reads during writes.

**Zod** -- A TypeScript-first schema validation library. Used in mcp-taskflow to validate tool inputs at runtime.

---

*This documentation was written to be comprehensive enough for a developer to use as a reference and clear enough for a newcomer to follow. If something is unclear, the source code is the ultimate truth -- start with `src/index.ts` and follow the imports.*
