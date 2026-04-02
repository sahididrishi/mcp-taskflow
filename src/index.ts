#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TaskflowDB } from "./database.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

const server = new McpServer({
  name: "mcp-taskflow",
  version: "1.0.0",
});

const db = new TaskflowDB();

registerTools(server, db);
registerResources(server, db);
registerPrompts(server, db);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-taskflow server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
