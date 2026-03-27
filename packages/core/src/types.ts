export const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export const ENTRY_TYPES = ["task", "note", "wish", "trash"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const TASK_STATUSES = ["pending", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface RawEntry {
  id: string;
  raw_text: string;
  created_at: string;
  processed: boolean;
}

export interface ProcessedFields {
  type: EntryType;
  title: string;
  tags: string[];
  urgent: boolean;
  due_date: string | null; // ISO string, task only
  status: TaskStatus | null; // task only
}

export interface Entry extends RawEntry {
  type: EntryType | null;
  title: string | null;
  tags: string[];
  urgent: boolean;
  due_date: string | null;
  status: TaskStatus | null;
  delegatable: boolean;
  image_path: string | null;
  result: string | null;
  result_url: string | null;
  result_seen: boolean;
  completed_at: string | null;
  source: string | null;
  decision_options: string[] | null;
  decision_selected: number | null;
  decision_comment: string | null;
  archived_at: string | null;
  parent_id: string | null;
  result_type: string | null;
  result_file: string | null;
  reopen_count: number;
}

export interface ReopenCycle {
  id: string;
  entry_id: string;
  result: string;
  result_type: string | null;
  feedback: string;
  completed_at: string;
  reopened_at: string;
}

export interface CreateEntryInput {
  raw_text: string;
  image_path?: string;
  // Pre-classified fields — if type + title provided, entry is marked as processed
  type?: EntryType;
  title?: string;
  tags?: string[];
  urgent?: boolean;
  due_date?: string | null;
  delegatable?: boolean;
  source?: string;
  result?: string;
  result_url?: string;
  decision_options?: string[];
  parent_id?: string;
}

export interface SubmitProcessedInput {
  id: string;
  type: EntryType;
  title: string;
  tags: string[];
  urgent: boolean;
  due_date: string | null;
  delegatable: boolean;
}

export interface UpdateEntryInput {
  id: string;
  title?: string;
  tags?: string[];
  urgent?: boolean;
  due_date?: string | null;
  status?: TaskStatus;
  type?: EntryType;
  delegatable?: boolean;
  result?: string;
  result_url?: string;
  result_seen?: boolean;
  decision_selected?: number | null;
  decision_comment?: string | null;
  image_path?: string;
}

export interface ListEntriesFilter {
  type?: EntryType;
  status?: TaskStatus;
  tag?: string;
  query?: string;
  processed?: boolean;
  delegatable?: boolean;
  source?: string; // filter by source (slack, auto-summary, etc.) — "any" matches all non-null
  since?: string; // ISO date — filter entries created on or after this date
  until?: string; // ISO date — filter entries created before this date
  includeArchived?: boolean; // include soft-deleted entries (default: false)
  parent_id?: string | null; // filter by parent_id; null means top-level only
  limit?: number;
  offset?: number;
  sort?: "created_at" | "updated_at" | "completed_at";
  cursor?: string; // cursor for cursor-based pagination (created_at|id)
}

export interface SubtaskInput {
  raw_text: string;
  title?: string;
  tags?: string[];
  urgent?: boolean;
  due_date?: string | null;
  delegatable?: boolean;
}

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export interface ScheduledTask {
  id: string;
  raw_text: string;
  frequency: ScheduleFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
}

export interface CreateScheduledTaskInput {
  raw_text: string;
  frequency: ScheduleFrequency;
  day_of_week?: number | null;
  day_of_month?: number | null;
  hour?: number;
}

export interface UpdateScheduledTaskInput {
  id: string;
  raw_text?: string;
  frequency?: ScheduleFrequency;
  day_of_week?: number | null;
  day_of_month?: number | null;
  hour?: number;
  enabled?: boolean;
}
