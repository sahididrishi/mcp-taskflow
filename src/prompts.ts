import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskflowDB } from "./database.js";

export function registerPrompts(server: McpServer, db: TaskflowDB): void {
  // ── Daily standup ─────────────────────────────────────
  server.prompt(
    "daily_standup",
    "Generate a daily standup report from today's activity",
    {},
    async () => {
      const dashboard = db.getDashboard();
      const context = JSON.stringify(dashboard, null, 2);

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Based on the following project dashboard data, generate a concise daily standup report. Include:

1. **What was completed** — list recently completed tasks
2. **What's in progress** — list tasks currently being worked on
3. **Blockers** — list any blocked or overdue tasks
4. **Time logged today** — summarize today's time

Keep it brief and actionable. Use bullet points.

Dashboard data:
${context}`,
            },
          },
        ],
      };
    }
  );

  // ── Weekly report ─────────────────────────────────────
  server.prompt(
    "weekly_report",
    "Generate a weekly status report summarizing progress across all active projects",
    {},
    async () => {
      const dashboard = db.getDashboard();
      const projectDetails = dashboard.projects.map((p) => {
        try {
          return db.exportProject(p.id);
        } catch {
          return null;
        }
      }).filter(Boolean);

      const context = JSON.stringify(
        { dashboard, projects: projectDetails },
        null,
        2
      );

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Based on the following data, write a professional weekly status report. Structure it as:

## Weekly Status Report

### Summary
(2-3 sentence high-level overview)

### Project Updates
(for each active project: progress, key completions, upcoming work)

### Time Investment
(breakdown of hours by project)

### Risks & Blockers
(any overdue or blocked items that need attention)

### Next Week Priorities
(top items for next week based on urgency and due dates)

Data:
${context}`,
            },
          },
        ],
      };
    }
  );

  // ── Project planning ──────────────────────────────────
  server.prompt(
    "plan_project",
    "Help plan and break down work for a specific project",
    {
      project_id: z
        .string()
        .describe("The project ID to plan for"),
    },
    async ({ project_id }) => {
      const id = parseInt(project_id, 10);
      let context: string;

      try {
        const data = db.exportProject(id);
        context = JSON.stringify(data, null, 2);
      } catch {
        context = `Project #${id} not found. Available projects: ${JSON.stringify(db.listProjects().map(p => ({ id: p.id, name: p.name })))}`;
      }

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Review the following project data and help me plan the next steps. Consider:

1. What tasks are already defined and their current status
2. What work might be missing or should be broken down further
3. Priority suggestions based on due dates and dependencies
4. Time estimates based on historical time tracking data
5. Suggested tags for organization

Respond with actionable suggestions I can implement using taskflow tools (create_task, update_task, tag_task, etc.).

Project data:
${context}`,
            },
          },
        ],
      };
    }
  );
}
