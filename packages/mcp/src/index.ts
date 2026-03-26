import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createDatabase,
  ENTRY_TYPES,
  type Entry,
  EntryRepository,
  EntryService,
  ScheduledTaskRepository,
} from "@theledger/core";
import { z } from "zod";

const db = createDatabase();
const repository = new EntryRepository(db);
const scheduledTaskRepository = new ScheduledTaskRepository(db);
const service = new EntryService(repository, scheduledTaskRepository);

const server = new McpServer({
  name: "theledger",
  version: "0.0.1",
});

// --- Tools ---

server.tool(
  "add_entry",
  "Add a new raw entry to The Ledger. Just throw in whatever you're thinking. Optionally attach an image.",
  {
    raw_text: z.string().describe("The raw text of the thought, idea, task, etc."),
    image: z.string().optional().describe("Base64-encoded image data (optional)"),
    image_ext: z
      .string()
      .optional()
      .describe("Image file extension: png, jpg, jpeg, gif, webp (optional)"),
  },
  async ({ raw_text, image, image_ext }) => {
    let entry: Entry;
    if (image && image_ext) {
      const imageData = Buffer.from(image, "base64");
      entry = service.createEntryWithImage(raw_text, imageData, image_ext);
    } else {
      entry = service.createEntry({ raw_text });
    }
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  },
);

server.tool(
  "get_unprocessed",
  "Get unprocessed entries that need LLM classification (type, tags, title, priority). Entries with images include base64 image content.",
  {
    limit: z.number().int().positive().max(50).default(20).describe("Max entries to return"),
  },
  async ({ limit }) => {
    const entries = service.getUnprocessed(limit);
    const content: Array<
      { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
    > = [{ type: "text", text: JSON.stringify(entries, null, 2) }];
    for (const entry of entries) {
      if (entry.image_path && fs.existsSync(entry.image_path)) {
        const ext = path.extname(entry.image_path).slice(1).toLowerCase();
        const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const data = fs.readFileSync(entry.image_path).toString("base64");
        content.push({
          type: "image",
          data,
          mimeType,
        });
      }
    }
    return { content };
  },
);

server.tool(
  "submit_processed",
  "Submit LLM processing results for an entry: type, title, tags, urgent, delegatable.",
  {
    id: z.string().describe("Entry ID"),
    type: z.enum(ENTRY_TYPES).describe("Classified type: task, event, note, or wish"),
    title: z.string().describe("Short title summarizing the entry"),
    tags: z.array(z.string()).describe("Auto-assigned tags for categorization"),
    urgent: z.boolean().default(false).describe("Whether this is urgent"),
    due_date: z
      .string()
      .nullable()
      .describe("ISO date string for deadline (tasks/events, null otherwise)"),
    delegatable: z
      .boolean()
      .default(false)
      .describe("Whether this task can be delegated to an LLM"),
  },
  async ({ id, type, title, tags, urgent, due_date, delegatable }) => {
    const entry = service.submitProcessed({
      id,
      type,
      title,
      tags,
      urgent,
      due_date,
      delegatable,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  },
);

server.tool(
  "get_delegatable_tasks",
  "Get pending tasks that can be delegated to an LLM. Use this to find work you can do.",
  {
    limit: z.number().int().positive().max(50).default(10).describe("Max tasks to return"),
  },
  async ({ limit }) => {
    const entries = service.listEntries({
      type: "task",
      status: "pending",
      delegatable: true,
      limit,
      offset: 0,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
    };
  },
);

server.tool(
  "complete_task",
  "Complete a delegatable task by writing the result. Automatically sets status to done. Use this when you finish working on a delegatable task.",
  {
    id: z.string().describe("Entry ID of the task to complete"),
    result: z
      .string()
      .describe(
        "Markdown-formatted summary of completed work. Use headings, lists, bold for structure.",
      ),
  },
  async ({ id, result }) => {
    const entry = service.updateEntry({ id, status: "done", result });
    return {
      content: [{ type: "text", text: entry ? JSON.stringify(entry, null, 2) : "Entry not found" }],
    };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("The Ledger MCP server running on stdio");
}

main().catch(console.error);
