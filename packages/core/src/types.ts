export const ENTRY_TYPES = ["task", "event", "note", "wish", "trash"] as const;
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
  priority: number | null; // 1-5, task only
  due_date: string | null; // ISO string, task/event only
  status: TaskStatus | null; // task only
}

export interface Entry extends RawEntry {
  type: EntryType | null;
  title: string | null;
  tags: string[];
  priority: number | null;
  due_date: string | null;
  status: TaskStatus | null;
  delegatable: boolean;
}

export interface CreateEntryInput {
  raw_text: string;
}

export interface SubmitProcessedInput {
  id: string;
  type: EntryType;
  title: string;
  tags: string[];
  priority: number | null;
  due_date: string | null;
  delegatable: boolean;
}

export interface UpdateEntryInput {
  id: string;
  title?: string;
  tags?: string[];
  priority?: number;
  due_date?: string | null;
  status?: TaskStatus;
  type?: EntryType;
  delegatable?: boolean;
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
}
