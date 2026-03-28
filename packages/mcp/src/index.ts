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
  TASK_STATUSES,
} from "@theledger/core";
import { z } from "zod";

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
  "Add a new raw entry to The Ledger. Just throw in whatever you're thinking. Optionally attach an image.",
  {
    raw_text: z.string().max(10000).describe("The raw text of the thought, idea, task, etc."),
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
      entry = service.createEntryWithImage(imageData, image_ext, { raw_text });
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
    type: z
      .enum(["task", "note", "wish"] as const)
      .describe("Classified type: task, note, or wish"),
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
      content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
    };
  },
);

server.tool(
  "update_entry",
  "Update an entry's fields: title, tags, urgent, due_date, status, type, result.",
  {
    id: z.string().describe("Entry ID"),
    title: z.string().optional().describe("New title"),
    tags: z.array(z.string()).optional().describe("Replace tags"),
    urgent: z.boolean().optional().describe("Whether this is urgent"),
    due_date: z.string().nullable().optional().describe("New due date"),
    status: z.enum(TASK_STATUSES).optional().describe("New status (tasks only)"),
    type: z.enum(ENTRY_TYPES).optional().describe("Change type"),
    result: z
      .string()
      .optional()
      .describe(
        "Markdown-formatted summary of completed work. Use headings, lists, bold for structure. Written when completing a delegatable task.",
      ),
  },
  async ({ id, title, tags, urgent, due_date, status, type, result }) => {
    const entry = service.updateEntry({ id, title, tags, urgent, due_date, status, type, result });
    return {
      content: [{ type: "text", text: entry ? JSON.stringify(entry, null, 2) : "Entry not found" }],
    };
  },
);

server.tool(
  "complete_task",
  "Complete a delegatable task: mark as done, write result summary, and optionally attach a result file.",
  {
    id: z.string().describe("Entry ID of the task to complete"),
    result: z
      .string()
      .max(50000)
      .describe(
        "Markdown-formatted summary of completed work. Use headings, lists, bold for structure.",
      ),
    result_file: z
      .string()
      .optional()
      .describe(
        "Absolute path to a local file to attach as the task result (e.g. generated report, image).",
      ),
  },
  async ({ id, result, result_file }) => {
    const entry = service.updateEntry({
      id,
      status: "done",
      result,
    });
    if (!entry) {
      return { content: [{ type: "text", text: "Entry not found" }] };
    }
    if (result_file) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        if (fs.existsSync(result_file)) {
          const ext = path.extname(result_file).slice(1).toLowerCase();
          const destDir = path.join((await import("node:os")).homedir(), ".theledger", "results");
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          const destFile = `${id}.${ext}`;
          fs.copyFileSync(result_file, path.join(destDir, destFile));
          service.updateEntry({ id, result_url: `/results/${destFile}` });
        }
      } catch {
        // File attachment is best-effort
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  },
);

server.tool(
  "delete_entry",
  "Soft-delete an entry (moves to trash, can be restored).",
  {
    id: z.string().describe("Entry ID to delete"),
  },
  async ({ id }) => {
    const deleted = service.deleteEntry(id);
    return {
      content: [{ type: "text", text: deleted ? "Deleted" : "Entry not found" }],
    };
  },
);

server.tool(
  "get_today_tasks",
  "Get today's briefing: overdue tasks, due today, urgent items, and yesterday's completions.",
  {
    today: z.string().optional().describe("ISO date string (YYYY-MM-DD), defaults to today"),
  },
  async ({ today }) => {
    const data = service.getTodayBriefingData(today);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
);

server.tool(
  "get_entry_history",
  "Get the reopen/feedback history for an entry. Returns an array of ReopenCycle records.",
  {
    entry_id: z.string().describe("Entry ID to get history for"),
  },
  async ({ entry_id }) => {
    const history = service.getEntryHistory(entry_id);
    return {
      content: [{ type: "text", text: JSON.stringify(history, null, 2) }],
    };
  },
);

server.tool(
  "reopen_task",
  "Reopen a completed task with optional feedback. Resets status to 'open' and records the reopen cycle.",
  {
    id: z.string().describe("Entry ID of the task to reopen"),
    feedback: z.string().optional().describe("Feedback explaining why the task is being reopened"),
  },
  async ({ id, feedback }) => {
    const entry = service.reopenTask(id, feedback);
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  },
);

server.tool(
  "ask_human",
  "Ask the human owner a question and present decision options. Creates a decision-pending entry that appears in the human's 判断待ち queue.",
  {
    question: z
      .string()
      .describe("The question or context for the decision. Explain what you need decided and why."),
    options: z
      .array(z.string())
      .min(2)
      .max(20)
      .describe('The options for the human to choose from. E.g. ["Approve", "Reject"]'),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    urgent: z.boolean().default(false).describe("Whether this decision is urgent"),
  },
  async ({ question, options, tags, urgent }) => {
    const entry = service.createEntry({
      raw_text: question,
      type: "task",
      title: question.length > 200 ? `${question.slice(0, 197)}...` : question,
      tags: tags ?? ["decision"],
      urgent,
      delegatable: true,
      decision_options: options,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
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
