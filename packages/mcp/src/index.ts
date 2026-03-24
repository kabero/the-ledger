import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createDatabase,
  EntryRepository,
  EntryService,
  ENTRY_TYPES,
  TASK_STATUSES,
} from "@theledger/core";

const db = createDatabase();
const repository = new EntryRepository(db);
const service = new EntryService(repository);

const server = new McpServer({
  name: "theledger",
  version: "0.0.1",
});

// --- Tools ---

server.tool(
  "add_entry",
  "Add a new raw entry to The Ledger. Just throw in whatever you're thinking.",
  {
    raw_text: z.string().describe("The raw text of the thought, idea, task, etc."),
  },
  async ({ raw_text }) => {
    const entry = service.createEntry({ raw_text });
    return {
      content: [
        { type: "text", text: JSON.stringify(entry, null, 2) },
      ],
    };
  }
);

server.tool(
  "get_unprocessed",
  "Get unprocessed entries that need LLM classification (type, tags, title, priority).",
  {
    limit: z.number().int().positive().max(50).default(20).describe("Max entries to return"),
  },
  async ({ limit }) => {
    const entries = service.getUnprocessed(limit);
    return {
      content: [
        { type: "text", text: JSON.stringify(entries, null, 2) },
      ],
    };
  }
);

server.tool(
  "submit_processed",
  "Submit LLM processing results for an entry: type, title, tags, priority.",
  {
    id: z.string().describe("Entry ID"),
    type: z.enum(ENTRY_TYPES).describe("Classified type: task, event, note, or wish"),
    title: z.string().describe("Short title summarizing the entry"),
    tags: z.array(z.string()).describe("Auto-assigned tags for categorization"),
    priority: z
      .number()
      .int()
      .min(1)
      .max(5)
      .nullable()
      .describe("Priority 1-5 (for tasks only, null otherwise)"),
    due_date: z
      .string()
      .nullable()
      .describe("ISO date string for deadline (tasks/events, null otherwise)"),
    delegatable: z
      .boolean()
      .default(false)
      .describe("Whether this task can be delegated to an LLM"),
  },
  async ({ id, type, title, tags, priority, due_date, delegatable }) => {
    const entry = service.submitProcessed({ id, type, title, tags, priority, due_date, delegatable });
    return {
      content: [
        { type: "text", text: JSON.stringify(entry, null, 2) },
      ],
    };
  }
);

server.tool(
  "list_entries",
  "List entries with optional filters: type, status, tag, text search query.",
  {
    type: z.enum(ENTRY_TYPES).optional().describe("Filter by type"),
    status: z.enum(TASK_STATUSES).optional().describe("Filter by task status"),
    tag: z.string().optional().describe("Filter by tag"),
    query: z.string().optional().describe("Full-text search query"),
    processed: z.boolean().optional().describe("Filter by processed status"),
    delegatable: z.boolean().optional().describe("Filter by LLM-delegatable tasks"),
    limit: z.number().int().positive().max(100).default(20).describe("Max results"),
    offset: z.number().int().nonnegative().default(0).describe("Offset for pagination"),
  },
  async (params) => {
    const entries = service.listEntries(params);
    return {
      content: [
        { type: "text", text: JSON.stringify(entries, null, 2) },
      ],
    };
  }
);

server.tool(
  "update_entry",
  "Update an entry's fields: title, tags, priority, due_date, status, type.",
  {
    id: z.string().describe("Entry ID"),
    title: z.string().optional().describe("New title"),
    tags: z.array(z.string()).optional().describe("Replace tags"),
    priority: z.number().int().min(1).max(5).optional().describe("New priority"),
    due_date: z.string().nullable().optional().describe("New due date"),
    status: z.enum(TASK_STATUSES).optional().describe("New status (tasks only)"),
    type: z.enum(ENTRY_TYPES).optional().describe("Change type"),
  },
  async ({ id, ...updates }) => {
    const entry = service.updateEntry({ id, ...updates });
    return {
      content: [
        { type: "text", text: entry ? JSON.stringify(entry, null, 2) : "Entry not found" },
      ],
    };
  }
);

server.tool(
  "delete_entry",
  "Delete an entry permanently.",
  {
    id: z.string().describe("Entry ID to delete"),
  },
  async ({ id }) => {
    const deleted = service.deleteEntry(id);
    return {
      content: [
        { type: "text", text: deleted ? "Deleted" : "Entry not found" },
      ],
    };
  }
);

server.tool(
  "get_today_tasks",
  "Get today's top tasks ranked by priority, urgency, and freshness. Default: top 3.",
  {
    limit: z.number().int().positive().max(10).default(3).describe("Number of tasks to return"),
  },
  async ({ limit }) => {
    const tasks = service.getTodayTasks(limit);
    return {
      content: [
        { type: "text", text: JSON.stringify(tasks, null, 2) },
      ],
    };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("The Ledger MCP server running on stdio");
}

main().catch(console.error);
