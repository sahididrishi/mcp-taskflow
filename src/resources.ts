import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TaskflowDB } from "./database.js";

export function registerResources(server: McpServer, db: TaskflowDB): void {
  // ── Static resource: dashboard overview ───────────────
  server.resource(
    "dashboard",
    "taskflow://dashboard",
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(db.getDashboard(), null, 2),
        },
      ],
    })
  );

  // ── Template resource: project details ────────────────
  server.resource(
    "project",
    new ResourceTemplate("taskflow://project/{projectId}", {
      list: async () => ({
        resources: db.listProjects().map((p) => ({
          uri: `taskflow://project/${p.id}`,
          name: p.name,
          description: p.description ?? undefined,
          mimeType: "application/json",
        })),
      }),
    }),
    async (uri, variables) => {
      const id = parseInt(variables.projectId as string, 10);
      if (isNaN(id)) return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Invalid ID" }] };
      const data = db.exportProject(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // ── Template resource: individual task ────────────────
  server.resource(
    "task",
    new ResourceTemplate("taskflow://task/{taskId}", {
      list: undefined,
    }),
    async (uri, variables) => {
      const id = parseInt(variables.taskId as string, 10);
      if (isNaN(id)) return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Invalid ID" }] };
      const task = db.getTaskWithDetails(id);
      if (!task) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Task #${id} not found`,
            },
          ],
        };
      }
      const notes = db.listNotes({ task_id: id });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ ...task, notes }, null, 2),
          },
        ],
      };
    }
  );
}
