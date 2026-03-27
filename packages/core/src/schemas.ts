import { z } from "zod";
import { ENTRY_TYPES, TASK_STATUSES } from "./types.js";

// ─── Shared enums ────────────────────────────────────────────────

export const entryTypeSchema = z.enum(ENTRY_TYPES);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const scheduleFrequencySchema = z.enum(["daily", "weekly", "monthly"]);

// ─── Tag schema ──────────────────────────────────────────────────

export const tagSchema = z.string().max(20);
export const tagsSchema = z.array(tagSchema);

// ─── CreateEntryInput ────────────────────────────────────────────

export const createEntryInputSchema = z
  .object({
    raw_text: z.string().min(1, "raw_text must not be empty").max(50_000, "raw_text too long"),
    image_path: z.string().optional(),
    type: entryTypeSchema.optional(),
    title: z.string().max(200, "title too long").optional(),
    tags: tagsSchema.optional(),
    urgent: z.boolean().optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}/, "Invalid due_date format. Expected ISO date (YYYY-MM-DD).")
      .nullable()
      .optional(),
    delegatable: z.boolean().optional(),
    source: z.string().optional(),
    result: z.string().optional(),
    result_url: z.string().optional(),
    decision_options: z.array(z.string()).max(20, "Too many decision_options (max 20)").optional(),
  })
  .refine((data) => !(data.type && !data.title), {
    message: "title is required when type is provided",
    path: ["title"],
  });

// ─── SubmitProcessedInput ────────────────────────────────────────

export const submitProcessedInputSchema = z.object({
  id: z.string(),
  type: entryTypeSchema,
  title: z.string().min(1),
  tags: tagsSchema,
  urgent: z.boolean().default(false),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "Invalid due_date format")
    .nullable(),
  delegatable: z.boolean().default(false),
});

// ─── UpdateEntryInput ────────────────────────────────────────────

export const updateEntryInputSchema = z.object({
  id: z.string(),
  title: z.string().max(200).optional(),
  tags: tagsSchema.optional(),
  urgent: z.boolean().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "Invalid due_date format")
    .nullable()
    .optional(),
  status: taskStatusSchema.optional(),
  type: entryTypeSchema.optional(),
  delegatable: z.boolean().optional(),
  result: z.string().optional(),
  result_url: z.string().optional(),
  result_seen: z.boolean().optional(),
  decision_selected: z.number().int().nullable().optional(),
  decision_comment: z.string().nullable().optional(),
});

// ─── ListEntriesFilter ───────────────────────────────────────────

export const listEntriesFilterSchema = z.object({
  type: entryTypeSchema.optional(),
  status: taskStatusSchema.optional(),
  tag: z.string().optional(),
  query: z.string().optional(),
  processed: z.boolean().optional(),
  delegatable: z.boolean().optional(),
  source: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  includeArchived: z.boolean().optional(),
  parent_id: z.string().nullable().optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
  sort: z.enum(["created_at", "updated_at", "completed_at"]).optional(),
  cursor: z.string().optional(),
});

// ─── ReopenTaskInput ────────────────────────────────────────────

export const REOPEN_REASONS = ["再調査", "やり直し", "再オープン"] as const;
/** Kept for backward compat; reopen_reason now accepts any string. */
export type ReopenReason = string;

export const reopenTaskInputSchema = z.object({
  id: z.string(),
  feedback: z.string().max(10_000, "feedback too long").optional(),
  reopen_reason: z
    .string()
    .optional()
    .describe(
      `Reason for reopening. Appended as [reason] suffix to title. Defaults to 再オープン. Suggested values: ${REOPEN_REASONS.join(", ")}`,
    ),
});

// ─── BulkTagRenameInput ─────────────────────────────────────────

export const bulkTagRenameInputSchema = z.object({
  old_tag: z.string().min(1).max(20),
  new_tag: z.string().min(1).max(20),
});

// ─── MergeTagsInput ─────────────────────────────────────────────

export const mergeTagsInputSchema = z.object({
  source_tags: z.array(z.string().min(1).max(20)).min(1),
  target_tag: z.string().min(1).max(20),
});

// ─── SubtaskInput / AddSubtasksInput ─────────────────────────────

export const subtaskInputSchema = z.object({
  raw_text: z.string().min(1).max(50_000),
  title: z.string().max(200).optional(),
  tags: tagsSchema.optional(),
  urgent: z.boolean().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "Invalid due_date format")
    .nullable()
    .optional(),
  delegatable: z.boolean().optional(),
});

export const addSubtasksInputSchema = z.object({
  parent_id: z.string(),
  subtasks: z.array(subtaskInputSchema).min(1).max(50),
});

// ─── CreateScheduledTaskInput ────────────────────────────────────

export const createScheduledTaskInputSchema = z.object({
  raw_text: z.string().min(1),
  frequency: scheduleFrequencySchema,
  day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  hour: z.number().int().min(0).max(23).optional(),
});

// ─── UpdateScheduledTaskInput ────────────────────────────────────

export const updateScheduledTaskInputSchema = z.object({
  id: z.string(),
  raw_text: z.string().min(1).optional(),
  frequency: scheduleFrequencySchema.optional(),
  day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  enabled: z.boolean().optional(),
});
