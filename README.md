# mcp-taskflow

A full-featured [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that gives AI assistants the ability to manage projects, track tasks, log time, and generate reports — all stored in a local SQLite database. No cloud, no API keys, no accounts.

Built for **Claude Code**, **Claude Desktop**, and any MCP-compatible client.

```
"Create a project called 'Website Redesign', add three tasks with priorities, tag them, and show me the dashboard"
```

## Architecture

```
┌──────────────────────────────────────────────┐
│                  MCP Client                  │
│         (Claude Code / Claude Desktop)       │
└──────────────┬───────────────────────────────┘
               │ stdio (JSON-RPC)
┌──────────────▼───────────────────────────────┐
│             mcp-taskflow server              │
│                                              │
│  ┌─────────┐  ┌───────────┐  ┌───────────┐  │
│  │ 20 Tools│  │ Resources │  │  Prompts  │  │
│  │         │  │           │  │           │  │
│  │ CRUD    │  │ dashboard │  │ standup   │  │
│  │ search  │  │ project/* │  │ weekly    │  │
│  │ tags    │  │ task/*    │  │ planning  │  │
│  │ time    │  │           │  │           │  │
│  │ export  │  │           │  │           │  │
│  └────┬────┘  └─────┬─────┘  └─────┬─────┘  │
│       └─────────────┼───────────────┘        │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │           TaskflowDB class           │    │
│  │    (typed queries, migrations)       │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │   SQLite (WAL mode, foreign keys)   │    │
│  │   ~/.mcp-taskflow/taskflow.db       │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## Features

### Tools (20 tools)

| Category | Tool | Description |
|----------|------|-------------|
| **Projects** | `create_project` | Create a project with name and description |
| | `list_projects` | List all projects, filter by status |
| | `update_project` | Change name, description, or status |
| | `delete_project` | Delete project and all related data |
| **Tasks** | `create_task` | Create with priority, due date, and tags in one call |
| | `list_tasks` | List with status and tag filters |
| | `update_task` | Update any field; auto-tracks completion timestamp |
| | `delete_task` | Remove task and all associated data |
| **Tags** | `tag_task` | Add a tag (auto-created if new) with optional color |
| | `untag_task` | Remove a tag from a task |
| | `list_tags` | All tags with usage counts |
| | `delete_tag` | Remove a tag globally |
| **Time** | `log_time` | Record minutes spent on a task |
| | `time_report` | Per-project breakdown with optional date range |
| **Notes** | `add_note` | Attach markdown notes to projects or tasks |
| | `list_notes` | Filter by project or task |
| | `delete_note` | Remove a note |
| **Search** | `search` | Full cross-entity search with scope filtering |
| **Overview** | `dashboard` | Stats, urgents, overdue, completions, time, tags |
| | `export_project` | Complete project snapshot as structured JSON |

### Resources (MCP resource protocol)

Most MCP servers only implement tools. This server also exposes **browsable resources**:

| URI | Description |
|-----|-------------|
| `taskflow://dashboard` | Live dashboard data |
| `taskflow://project/{id}` | Full project detail with tasks, notes, and time |
| `taskflow://task/{id}` | Individual task with notes |

Resources support the `list` operation — clients can discover available projects dynamically.

### Prompts (MCP prompt protocol)

Pre-built prompt templates that use live data from your projects:

| Prompt | Description |
|--------|-------------|
| `daily_standup` | Generates a standup report from today's activity |
| `weekly_report` | Professional weekly status across all active projects |
| `plan_project` | Breaks down project work and suggests next steps |

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/mcp-taskflow.git
cd mcp-taskflow
npm install
npm run build
```

### Verify it works

```bash
npm test
```

## Setup

### Claude Code

Add to your Claude Code settings (`~/.claude/settings.json`):

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

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Custom database location

Set the `TASKFLOW_DB_PATH` environment variable:

```json
{
  "mcpServers": {
    "taskflow": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-taskflow/dist/index.js"],
      "env": {
        "TASKFLOW_DB_PATH": "/path/to/my/taskflow.db"
      }
    }
  }
}
```

## Usage Examples

Once connected, just talk to Claude naturally:

**Project management:**
> "Create a project called 'Mobile App v2' — it's a React Native rewrite of our existing iOS app"

**Task creation with tags:**
> "Add these tasks to Mobile App v2: set up navigation (high priority, tag: architecture), implement auth flow (urgent, due Friday, tags: auth, security), and design the settings screen (low priority, tag: design)"

**Time tracking:**
> "I spent 2 hours on the auth flow task and 30 minutes reviewing the navigation setup"

**Getting oriented:**
> "Show me the dashboard"
> "What tasks are blocked right now?"
> "Search for anything related to 'authentication'"

**Reporting:**
> "Generate a weekly report"
> "How much time has been logged on Mobile App v2 this month?"
> "Export the Mobile App v2 project"

**Planning:**
> "Help me plan the next sprint for Mobile App v2"

## Data Model

```
projects 1──* tasks 1──* time_entries
    │            │
    │            ├──* notes
    │            │
    │            └──* task_tags *──1 tags
    │
    └──* notes
```

- **Projects** — top-level containers with status tracking
- **Tasks** — work items with priority, status, due dates, and auto-tracked completion
- **Tags** — case-insensitive labels with colors, many-to-many with tasks
- **Time entries** — minutes logged per task with descriptions
- **Notes** — markdown content attached to projects or tasks

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js |
| Language | TypeScript (strict mode) |
| MCP SDK | `@modelcontextprotocol/sdk` — official Anthropic SDK |
| Database | SQLite via `better-sqlite3` (WAL mode, foreign keys) |
| Validation | Zod — runtime schema validation for all inputs |
| Tests | Node.js built-in test runner (50 tests) |

## Project Structure

```
mcp-taskflow/
├── src/
│   ├── index.ts          # Entry point — wires everything together
│   ├── types.ts          # TypeScript interfaces for all data models
│   ├── database.ts       # TaskflowDB class with migrations and queries
│   ├── tools.ts          # 20 MCP tool registrations with structured logging
│   ├── resources.ts      # MCP resource definitions
│   ├── prompts.ts        # MCP prompt templates
│   ├── logger.ts         # Structured JSON logging to stderr
│   └── errors.ts         # Custom error hierarchy (NotFoundError, ValidationError)
├── tests/
│   ├── database.test.ts  # 37 tests covering all database operations
│   └── tools.test.ts     # 13 tests for error hierarchy and tool integration
├── dist/                 # Compiled JavaScript (after npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

## Design Decisions

- **Singleton DB class** — one connection per server lifetime, not per-request. Cleaner, faster, and testable (constructor accepts custom path).
- **Schema migrations** — versioned migrations tracked in a `schema_version` table. Adding new tables only requires appending to the `MIGRATIONS` array.
- **Auto-completion tracking** — `completed_at` is set automatically when a task moves to `done` and cleared if it moves back. No manual timestamp management.
- **Case-insensitive tags** — `COLLATE NOCASE` on the tags table prevents duplicates like "Bug" and "bug".
- **WAL mode** — SQLite's Write-Ahead Logging for better concurrent read performance.
- **Foreign keys with CASCADE** — deleting a project automatically cleans up all tasks, time entries, notes, and tag associations.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-tool`)
3. Write tests for your changes
4. Ensure all tests pass (`npm test`)
5. Build successfully (`npm run build`)
6. Submit a pull request

## License

MIT
