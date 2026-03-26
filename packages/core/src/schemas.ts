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
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
  sort: z.enum(["created_at", "updated_at", "completed_at"]).optional(),
  cursor: z.string().optional(),
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
