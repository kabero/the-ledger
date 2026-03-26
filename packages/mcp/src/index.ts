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
  TASK_STATUSES,
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

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// --- Tools ---

server.tool(
  "add_entry",
  "Add a new entry to The Ledger. Provide just raw_text for quick capture (will need processing later), or include type + title to add a pre-classified entry that skips the processing queue. For tasks that require human action (physical tasks, phone calls, in-person meetings), set delegatable=false. For tasks an LLM can handle autonomously, set delegatable=true.",
  {
    raw_text: z.string().describe("The raw text of the thought, idea, task, etc."),
    type: z.enum(ENTRY_TYPES).optional().describe("Pre-classify: task, note, wish, or trash"),
    title: z.string().optional().describe("Short title (required if type is provided)"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    urgent: z.boolean().optional().describe("Whether this is urgent"),
    due_date: z.string().nullable().optional().describe("ISO date string for deadline"),
    delegatable: z.boolean().optional().describe("Whether this task can be delegated to an LLM"),
    source: z
      .string()
      .optional()
      .describe("Origin of the entry: slack, email, calendar, web, etc."),
    result: z
      .string()
      .optional()
      .describe("Markdown-formatted content body (e.g. summary, research results)"),
    result_url: z
      .string()
      .optional()
      .describe("URL to external result (e.g. GitHub PR, deployed page, document)"),
    decision_options: z
      .array(z.string())
      .optional()
      .describe(
        "Choice options for human decision (e.g. ['Option A', 'Option B']). Creates a decision-type entry that appears in the human's judgment queue.",
      ),
    image: z.string().optional().describe("Base64-encoded image data (optional)"),
    image_ext: z
      .string()
      .optional()
      .describe("Image file extension: png, jpg, jpeg, gif, webp (optional)"),
  },
  async ({
    raw_text,
    type,
    title,
    tags,
    urgent,
    due_date,
    delegatable,
    source,
    result,
    result_url,
    decision_options,
    image,
    image_ext,
  }) => {
    try {
      let entry: Entry;
      if (image && image_ext) {
        const imageData = Buffer.from(image, "base64");
        entry = service.createEntryWithImage(imageData, image_ext, {
          raw_text,
          type,
          title,
          tags,
          urgent,
          due_date,
          delegatable,
          source,
          result,
          result_url,
          decision_options,
        });
      } else {
        entry = service.createEntry({
          raw_text,
          type,
          title,
          tags,
          urgent,
          due_date,
          delegatable,
          source,
          result,
          result_url,
          decision_options,
        });
      }
      return {
        content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "get_unprocessed",
  "Get unprocessed entries that need LLM classification (type, tags, title, priority). Entries with images include base64 image content.",
  {
    limit: z.number().int().positive().max(50).default(20).describe("Max entries to return"),
  },
  async ({ limit }) => {
    try {
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
    } catch (err) {
      return errorResponse(err);
    }
  },
);

const TAG_PRESETS = [
  "work",
  "personal",
  "health",
  "finance",
  "learning",
  "shopping",
  "home",
  "communication",
  "automation",
  "research",
];
const MIN_VOCABULARY_SIZE = 10;
const MAX_TAG_LENGTH = 20;

server.tool(
  "get_tag_vocabulary",
  "Get existing tags with usage counts, plus presets if vocabulary is small. Call this before classifying entries to maintain consistent tagging. Tags should be lowercase, max 20 chars.",
  {},
  async () => {
    try {
      const existing = service.getTagVocabulary();
      const existingTags = new Set(existing.map((t) => t.tag));
      const presets =
        existing.length < MIN_VOCABULARY_SIZE
          ? TAG_PRESETS.filter((t) => !existingTags.has(t)).map((tag) => ({ tag, count: 0 }))
          : [];

      // Detect dominant language from existing tags
      const jaCount = existing.filter((t) => /[\u3000-\u9fff\uff00-\uffef]/.test(t.tag)).length;
      const enCount = existing.filter((t) => /^[a-z0-9-]+$/.test(t.tag)).length;
      const dominantLang = jaCount > enCount ? "ja" : enCount > jaCount ? "en" : "mixed";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                existing,
                presets,
                rules: {
                  max_length: MAX_TAG_LENGTH,
                  dominant_language: dominantLang,
                  style:
                    dominantLang === "ja"
                      ? "日本語タグ優先、既存タグを再利用、最大20文字"
                      : dominantLang === "en"
                        ? "lowercase english, no spaces (use hyphens), reuse existing tags"
                        : "match language of existing tags in same category, max 20 chars",
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

const processedEntrySchema = z.object({
  id: z.string().describe("Entry ID"),
  type: z.enum(ENTRY_TYPES).describe("Classified type: task, note, wish, or trash"),
  title: z.string().describe("Short title summarizing the entry"),
  tags: z.array(z.string()).describe("Auto-assigned tags for categorization"),
  urgent: z.boolean().default(false).describe("Whether this is urgent"),
  due_date: z
    .string()
    .nullable()
    .describe("ISO date string for deadline (tasks/events, null otherwise)"),
  delegatable: z.boolean().default(false).describe("Whether this task can be delegated to an LLM"),
});

server.tool(
  "submit_processed",
  "Submit LLM processing results for entries. Accepts a single entry or a batch of entries.",
  {
    entries: z.array(processedEntrySchema).describe("Array of processed entries to submit"),
  },
  async ({ entries }) => {
    try {
      const results = entries.map((e) => service.submitProcessed(e));
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "get_delegatable_tasks",
  "Get pending tasks that can be delegated to an LLM. Use this to find work you can do.",
  {
    limit: z.number().int().positive().max(50).default(10).describe("Max tasks to return"),
  },
  async ({ limit }) => {
    try {
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
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "search_entries",
  "Search and filter entries. Use for finding related context, building summaries, or reviewing past work. By default only searches processed entries; set include_unprocessed=true to also search unprocessed entries.",
  {
    query: z.string().optional().describe("Full-text search query"),
    type: z.enum(ENTRY_TYPES).optional().describe("Filter by type"),
    status: z.enum(TASK_STATUSES).optional().describe("Filter by status"),
    tag: z.string().optional().describe("Filter by tag"),
    source: z
      .string()
      .optional()
      .describe(
        'Filter by source (e.g. "slack", "auto-summary"). Use "any" to match all sourced entries',
      ),
    since: z.string().optional().describe("ISO date — only entries created on or after this date"),
    until: z.string().optional().describe("ISO date — only entries created before this date"),
    include_unprocessed: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include unprocessed entries in search results (default: false)"),
    limit: z.number().int().positive().max(100).default(20).describe("Max results"),
  },
  async ({ query, type, status, tag, source, since, until, include_unprocessed, limit }) => {
    try {
      const entries = service.listEntries({
        query,
        type,
        status,
        tag,
        source,
        since,
        until,
        processed: include_unprocessed ? undefined : true,
        limit,
        offset: 0,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "search_entries_paginated",
  "Search entries with cursor-based pagination. Returns entries and a nextCursor for the next page. Use this for iterating through large result sets without missing or duplicating entries.",
  {
    query: z.string().optional().describe("Full-text search query"),
    type: z.enum(ENTRY_TYPES).optional().describe("Filter by type"),
    status: z.enum(TASK_STATUSES).optional().describe("Filter by status"),
    tag: z.string().optional().describe("Filter by tag"),
    source: z.string().optional().describe("Filter by source"),
    since: z.string().optional().describe("ISO date — only entries created on or after this date"),
    until: z.string().optional().describe("ISO date — only entries created before this date"),
    limit: z.number().int().positive().max(100).default(20).describe("Max results per page"),
    cursor: z
      .string()
      .optional()
      .describe("Cursor from previous response's nextCursor for next page"),
  },
  async ({ query, type, status, tag, source, since, until, limit, cursor }) => {
    try {
      const result = service.listEntriesWithCursor({
        query,
        type,
        status,
        tag,
        source,
        since,
        until,
        processed: true,
        limit,
        cursor,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { entries: result.entries, nextCursor: result.nextCursor },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "update_entry",
  "Update an existing entry's fields. Use this for partial updates like tags, urgency, due dates, type, status, delegatable flag, etc. Note: setting result automatically resets result_seen to false. For completing delegated tasks, prefer complete_task instead.",
  {
    id: z.string().describe("Entry ID to update"),
    type: z.enum(ENTRY_TYPES).optional().describe("Change type: task, note, wish, or trash"),
    title: z.string().optional().describe("Update title"),
    status: z.enum(TASK_STATUSES).optional().describe("Change status: pending or done"),
    tags: z.array(z.string()).optional().describe("Replace tags"),
    urgent: z.boolean().optional().describe("Set urgency"),
    due_date: z.string().nullable().optional().describe("Set or clear deadline (ISO date string)"),
    delegatable: z.boolean().optional().describe("Set whether task can be delegated to an LLM"),
    result: z.string().optional().describe("Set result content (markdown)"),
    result_url: z.string().optional().describe("Set result URL"),
    result_seen: z.boolean().optional().describe("Mark result as seen/unseen"),
    decision_selected: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("Index of selected decision option (0-based)"),
    decision_comment: z
      .string()
      .nullable()
      .optional()
      .describe("Human's free-form comment on the decision"),
  },
  async ({
    id,
    type,
    title,
    status,
    tags,
    urgent,
    due_date,
    delegatable,
    result,
    result_url,
    result_seen,
    decision_selected,
    decision_comment,
  }) => {
    try {
      const entry = service.updateEntry({
        id,
        type,
        title,
        status,
        tags,
        urgent,
        due_date,
        delegatable,
        result,
        result_url,
        result_seen,
        decision_selected,
        decision_comment,
      });
      if (!entry) {
        return {
          content: [{ type: "text", text: `Entry not found: ${id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "complete_task",
  "Complete a delegatable task by writing the result. Automatically sets status to done and resets result_seen to false (so the user sees the new result). Prefer this over update_entry when finishing delegated work, as it handles the done+result flow in one call.",
  {
    id: z.string().describe("Entry ID of the task to complete"),
    result: z
      .string()
      .describe(
        "Markdown-formatted summary of completed work. Use headings, lists, bold for structure.",
      ),
    result_url: z
      .string()
      .optional()
      .describe("URL to external result (e.g. GitHub PR, deployed page, document)"),
  },
  async ({ id, result, result_url }) => {
    try {
      const entry = service.updateEntry({ id, status: "done", result, result_url });
      if (!entry) {
        return {
          content: [{ type: "text", text: `Entry not found: ${id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "get_recent_activity",
  "Get a timeline of recent activity across all entry types: newly created, completed, and decision entries. Useful for understanding what happened recently.",
  {
    limit: z.number().int().positive().max(100).default(20).describe("Max entries to return"),
  },
  async ({ limit }) => {
    try {
      const entries = service.getRecentActivity(limit);
      return {
        content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "get_overdue_tasks",
  "Get pending tasks whose due date has passed. Useful for generating reminders or escalating forgotten work.",
  {
    before_date: z
      .string()
      .optional()
      .describe(
        "ISO date (YYYY-MM-DD) cutoff. Tasks due before this date are returned. Defaults to today.",
      ),
  },
  async ({ before_date }) => {
    try {
      const entries = service.getOverdueTasks(before_date);
      return {
        content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "purge_trash",
  "Permanently delete all entries classified as trash. Returns the number of entries deleted. Use after reviewing trash to free up space.",
  {},
  async () => {
    try {
      const count = service.purgeTrash();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ deleted: count }, null, 2),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "delete_entry",
  "Soft-delete an entry. The entry is archived (hidden from default views) but can be restored later with restore_entry.",
  {
    id: z.string().describe("Entry ID to delete"),
  },
  async ({ id }) => {
    try {
      const success = service.deleteEntry(id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ deleted: success, id }, null, 2),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.tool(
  "restore_entry",
  "Restore a previously soft-deleted (archived) entry, making it visible again in default views.",
  {
    id: z.string().describe("Entry ID to restore"),
  },
  async ({ id }) => {
    try {
      const success = service.restoreEntry(id);
      if (!success) {
        return {
          content: [{ type: "text", text: `Entry not found or not archived: ${id}` }],
          isError: true,
        };
      }
      const entry = service.getEntry(id);
      return {
        content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("The Ledger MCP server running on stdio");
}

main().catch(console.error);
