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
  result_seen: boolean;
  completed_at: string | null;
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
  result_seen?: boolean;
}

export interface ListEntriesFilter {
  type?: EntryType;
  status?: TaskStatus;
  tag?: string;
  query?: string;
  processed?: boolean;
  delegatable?: boolean;
  limit?: number;
  offset?: number;
  sort?: "created_at" | "updated_at" | "completed_at";
}
