import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { EntryRepository } from "./repository.js";
import type { ScheduledTaskRepository } from "./scheduled-task-repository.js";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  type CreateEntryInput,
  type CreateScheduledTaskInput,
  type Entry,
  type ListEntriesFilter,
  MAX_IMAGE_SIZE,
  type ScheduledTask,
  type SubmitProcessedInput,
  type SubtaskInput,
  type UpdateEntryInput,
  type UpdateScheduledTaskInput,
} from "./types.js";

const IMAGES_DIR = path.join(os.homedir(), ".theledger", "images");

/** Known image magic bytes signatures */
const IMAGE_SIGNATURES: Record<string, number[][]> = {
  png: [[0x89, 0x50, 0x4e, 0x47]], // \x89PNG
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  gif: [
    [0x47, 0x49, 0x46, 0x38, 0x37], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39], // GIF89a
  ],
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF (WebP container)
};

function validateImageMagicBytes(data: Buffer, ext: string): boolean {
  const signatures = IMAGE_SIGNATURES[ext];
  if (!signatures) return false;
  return signatures.some((sig) => {
    if (data.length < sig.length) return false;
    return sig.every((byte, i) => data[i] === byte);
  });
}

/** Normalize tags: lowercase, trim, deduplicate, limit length to 20 chars */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().slice(0, 20);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

export class EntryService {
  constructor(
    private repository: EntryRepository,
    private scheduledTaskRepository?: ScheduledTaskRepository,
  ) {}

  createEntry(input: CreateEntryInput): Entry {
    if (!input.raw_text || input.raw_text.trim().length === 0) {
      throw new Error("raw_text must not be empty");
    }
    if (input.raw_text.length > 50_000) {
      throw new Error(`raw_text too long: ${input.raw_text.length} chars (max 50000)`);
    }
    if (input.title !== undefined && input.title.length > 200) {
      throw new Error(`title too long: ${input.title.length} chars (max 200)`);
    }
    if (input.due_date !== undefined && input.due_date !== null) {
      if (!/^\d{4}-\d{2}-\d{2}/.test(input.due_date)) {
        throw new Error(
          `Invalid due_date format: "${input.due_date}". Expected ISO date (YYYY-MM-DD).`,
        );
      }
    }
    if (input.decision_options !== undefined && input.decision_options.length > 20) {
      throw new Error(`Too many decision_options: ${input.decision_options.length} (max 20)`);
    }
    if (input.tags) {
      input = { ...input, tags: normalizeTags(input.tags) };
    }
    return this.repository.create(input);
  }

  getEntry(id: string): Entry | null {
    return this.repository.getById(id);
  }

  getEntryOrThrow(id: string): Entry {
    const entry = this.repository.getById(id);
    if (!entry) {
      throw new Error(`Entry not found: ${id}`);
    }
    return entry;
  }

  listEntries(filter: ListEntriesFilter = {}): Entry[] {
    return this.repository.list(filter);
  }

  listEntriesWithCursor(filter: ListEntriesFilter = {}): {
    entries: Entry[];
    nextCursor: string | null;
  } {
    return this.repository.listWithCursor(filter);
  }

  countEntries(filter: ListEntriesFilter = {}): number {
    return this.repository.count(filter);
  }

  getUnprocessed(limit: number = 20): Entry[] {
    return this.repository.getUnprocessed(limit);
  }

  submitProcessed(input: SubmitProcessedInput): Entry {
    if (input.tags) {
      input = { ...input, tags: normalizeTags(input.tags) };
    }
    return this.repository.submitProcessed(input);
  }

  updateEntry(input: UpdateEntryInput): Entry | null {
    if (input.tags) {
      input = { ...input, tags: normalizeTags(input.tags) };
    }
    // Validate decision_selected is within bounds of decision_options
    if (input.decision_selected != null) {
      const entry = this.repository.getById(input.id);
      if (entry) {
        const options = entry.decision_options;
        if (!options || input.decision_selected < 0 || input.decision_selected >= options.length) {
          throw new Error(
            `decision_selected index ${input.decision_selected} is out of bounds (entry has ${options?.length ?? 0} options)`,
          );
        }
      }
    }
    return this.repository.update(input);
  }

  markAllResultsSeen(): number {
    return this.repository.markAllResultsSeen();
  }

  bulkUpdateStatus(ids: string[], status: "pending" | "done"): number {
    return this.repository.bulkUpdateStatus(ids, status);
  }

  bulkDelete(ids: string[]): number {
    return this.repository.bulkDelete(ids);
  }

  getOverdueTasks(beforeDate?: string): Entry[] {
    const date = beforeDate ?? new Date().toISOString().slice(0, 10);
    return this.repository.getOverdueTasks(date);
  }

  getTypeSummary(): { type: string; count: number }[] {
    return this.repository.getTypeSummary();
  }

  purgeTrash(): number {
    return this.repository.purgeTrash();
  }

  archiveCompleted(olderThanDays: number): number {
    return this.repository.archiveCompleted(olderThanDays);
  }

  findDuplicate(rawText: string): Entry | null {
    return this.repository.findDuplicate(rawText);
  }

  rebuildFtsIndex(): void {
    this.repository.rebuildFtsIndex();
  }

  getRecentActivity(limit: number = 20): Entry[] {
    return this.repository.getRecentActivity(limit);
  }

  deleteEntry(id: string): boolean {
    return this.repository.delete(id);
  }

  restoreEntry(id: string): boolean {
    return this.repository.restore(id);
  }

  hardDeleteEntry(id: string): boolean {
    // Clean up image file before hard-deleting DB record
    const entry = this.repository.getById(id);
    if (entry?.image_path) {
      try {
        if (fs.existsSync(entry.image_path)) {
          fs.unlinkSync(entry.image_path);
        }
      } catch {
        // Ignore file deletion errors — DB record should still be deleted
      }
    }
    return this.repository.hardDelete(id);
  }

  saveImage(data: Buffer, entryId: string, ext: string): string {
    const normalizedExt = ext.toLowerCase().replace(/^\./, "");
    if (
      !ALLOWED_IMAGE_EXTENSIONS.includes(normalizedExt as (typeof ALLOWED_IMAGE_EXTENSIONS)[number])
    ) {
      throw new Error(
        `Unsupported image format: ${normalizedExt}. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`,
      );
    }
    if (data.length > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${(data.length / 1024 / 1024).toFixed(1)}MB. Max: 10MB`);
    }
    // Validate magic bytes match claimed extension
    if (!validateImageMagicBytes(data, normalizedExt)) {
      throw new Error(
        `Image content does not match extension .${normalizedExt}. File may be corrupted or spoofed.`,
      );
    }
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
    const filePath = path.join(IMAGES_DIR, `${entryId}.${normalizedExt}`);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  createEntryWithImage(
    imageData: Buffer,
    ext: string,
    input: Omit<CreateEntryInput, "image_path"> = { raw_text: "(画像)" },
  ): Entry {
    const tempId = uuidv4();
    const imagePath = this.saveImage(imageData, tempId, ext);
    return this.repository.create({
      ...input,
      raw_text: input.raw_text || "(画像)",
      image_path: imagePath,
    });
  }

  private ensureScheduledTaskRepo(): ScheduledTaskRepository {
    if (!this.scheduledTaskRepository) {
      throw new Error("ScheduledTaskRepository is not configured");
    }
    return this.scheduledTaskRepository;
  }

  createScheduledTask(input: CreateScheduledTaskInput): ScheduledTask {
    if (input.hour !== undefined && (input.hour < 0 || input.hour > 23)) {
      throw new Error(`Invalid hour: ${input.hour}. Must be 0-23.`);
    }
    if (input.frequency === "weekly" && input.day_of_week != null) {
      if (input.day_of_week < 0 || input.day_of_week > 6) {
        throw new Error(`Invalid day_of_week: ${input.day_of_week}. Must be 0 (Sun) - 6 (Sat).`);
      }
    }
    if (input.frequency === "monthly" && input.day_of_month != null) {
      if (input.day_of_month < 1 || input.day_of_month > 31) {
        throw new Error(`Invalid day_of_month: ${input.day_of_month}. Must be 1-31.`);
      }
    }
    return this.ensureScheduledTaskRepo().create(input);
  }

  listScheduledTasks(): ScheduledTask[] {
    return this.ensureScheduledTaskRepo().list();
  }

  getScheduledTask(id: string): ScheduledTask | null {
    return this.ensureScheduledTaskRepo().getById(id);
  }

  updateScheduledTask(input: UpdateScheduledTaskInput): ScheduledTask | null {
    return this.ensureScheduledTaskRepo().update(input);
  }

  deleteScheduledTask(id: string): boolean {
    return this.ensureScheduledTaskRepo().delete(id);
  }

  getDelegatableTaskCount(): number {
    return this.repository.count({
      type: "task",
      status: "pending",
      delegatable: true,
    });
  }

  getUnseenResultCount(): number {
    return this.repository.getUnseenResultCount();
  }

  getPendingDecisionCount(): number {
    return this.repository.getPendingDecisionCount();
  }

  getEntriesByIds(ids: string[]): Entry[] {
    return this.repository.getByIds(ids);
  }

  getScheduledTaskCount(): number {
    return this.ensureScheduledTaskRepo().count();
  }

  getTagVocabulary(): { tag: string; count: number }[] {
    return this.repository.getTagVocabulary();
  }

  /**
   * Reopen a completed task, resetting status to pending.
   * Optionally append feedback text to the result field so the next worker
   * can see what was wrong and retry.
   */
  reopenTask(id: string, feedback?: string): Entry {
    const entry = this.repository.getById(id);
    if (!entry) {
      throw new Error(`Entry not found: ${id}`);
    }
    if (entry.status !== "done") {
      throw new Error(`Entry is not done (status=${entry.status}), cannot reopen`);
    }

    // Snapshot current result into entry_history
    if (entry.result) {
      // biome-ignore lint/suspicious/noExplicitAny: accessing internal db
      const db = (this.repository as any).db;
      db.prepare(
        "INSERT INTO entry_history (id, entry_id, result, result_type, feedback, completed_at, reopened_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        uuidv4(),
        id,
        entry.result,
        entry.result_type ?? null,
        feedback ?? "",
        entry.completed_at ?? new Date().toISOString(),
        new Date().toISOString(),
      );
    }

    // Reset entry and increment reopen_count
    const newTitle = entry.title?.startsWith("[再オープン]")
      ? entry.title
      : `[再オープン] ${entry.title ?? ""}`;

    const updated = this.repository.update({
      id,
      status: "pending",
      title: newTitle,
      result_seen: true,
    });

    // Increment reopen_count and clear completed_at
    const db = // biome-ignore lint/suspicious/noExplicitAny: accessing internal db
      (this.repository as any).db;
    db.prepare(
      "UPDATE entries SET reopen_count = reopen_count + 1, completed_at = NULL WHERE id = ?",
    ).run(id);

    if (!updated) {
      throw new Error(`Failed to reopen entry: ${id}`);
    }
    // biome-ignore lint/style/noNonNullAssertion: entry was just updated
    return this.repository.getById(id)!;
  }

  // biome-ignore lint/suspicious/noExplicitAny: returns raw DB rows
  getEntryHistory(entryId: string): any[] {
    const db = // biome-ignore lint/suspicious/noExplicitAny: accessing internal db
      (this.repository as any).db;
    return db
      .prepare("SELECT * FROM entry_history WHERE entry_id = ? ORDER BY reopened_at DESC")
      .all(entryId);
  }

  /**
   * Rename a tag across all entries. Returns number of entries affected.
   */
  bulkTagRename(oldTag: string, newTag: string): number {
    const normalizedOld = oldTag.trim().toLowerCase().slice(0, 20);
    const normalizedNew = newTag.trim().toLowerCase().slice(0, 20);
    if (!normalizedOld || !normalizedNew) {
      throw new Error("Tags must not be empty");
    }
    if (normalizedOld === normalizedNew) {
      throw new Error("Old and new tag are the same");
    }
    return this.repository.bulkTagRename(normalizedOld, normalizedNew);
  }

  /**
   * Merge multiple source tags into a single target tag.
   * All entries with any of the source tags will have that tag replaced with the target.
   * Returns total number of tag replacements made.
   */
  mergeTags(sourceTags: string[], targetTag: string): number {
    const normalizedTarget = targetTag.trim().toLowerCase().slice(0, 20);
    if (!normalizedTarget) {
      throw new Error("Target tag must not be empty");
    }
    const normalizedSources = sourceTags
      .map((t) => t.trim().toLowerCase().slice(0, 20))
      .filter((t) => t && t !== normalizedTarget);
    if (normalizedSources.length === 0) {
      throw new Error("No valid source tags to merge");
    }
    let total = 0;
    for (const src of normalizedSources) {
      total += this.repository.bulkTagRename(src, normalizedTarget);
    }
    return total;
  }

  /**
   * Export entries matching a filter as a JSON-serializable array.
   */
  exportEntries(filter: ListEntriesFilter = {}): Entry[] {
    // Override limit to allow full export
    return this.repository.list({ ...filter, limit: filter.limit ?? 10000 });
  }

  /**
   * Get subtasks (children) of a given parent entry.
   */
  getSubtasks(parentId: string): Entry[] {
    // Verify parent exists
    const parent = this.repository.getById(parentId);
    if (!parent) {
      throw new Error(`Parent entry not found: ${parentId}`);
    }
    return this.repository.getSubtasks(parentId);
  }

  /**
   * Add subtasks to an existing parent entry.
   * Each subtask is created as a task with parent_id set.
   * Returns the created subtask entries.
   */
  addSubtasks(parentId: string, subtasks: SubtaskInput[]): Entry[] {
    const parent = this.repository.getById(parentId);
    if (!parent) {
      throw new Error(`Parent entry not found: ${parentId}`);
    }
    if (parent.parent_id !== null) {
      throw new Error("Cannot add subtasks to a subtask (no nesting beyond one level)");
    }
    if (subtasks.length === 0) {
      throw new Error("subtasks array must not be empty");
    }
    if (subtasks.length > 50) {
      throw new Error(`Too many subtasks: ${subtasks.length} (max 50)`);
    }

    return this.repository.runInTransaction(() => {
      const created: Entry[] = [];
      for (const sub of subtasks) {
        const entry = this.createEntry({
          raw_text: sub.raw_text,
          type: "task",
          title: sub.title ?? sub.raw_text.slice(0, 200),
          tags: sub.tags,
          urgent: sub.urgent,
          due_date: sub.due_date,
          delegatable: sub.delegatable,
          parent_id: parentId,
        });
        created.push(entry);
      }
      return created;
    });
  }

  getStats() {
    return this.repository.getStats();
  }

  /**
   * Aggregated dashboard data — replaces 7 separate queries from AiFeed.
   */
  getDashboardData(): {
    inProgress: Entry[];
    completed: { entries: Entry[]; nextCursor: string | null };
    completedCount: number;
    unprocessed: Entry[];
    humanTasks: Entry[];
    pendingDecisions: Entry[];
  } {
    return {
      inProgress: this.listEntries({ delegatable: true, status: "pending", limit: 50 }),
      completed: this.listEntriesWithCursor({
        delegatable: true,
        status: "done",
        sort: "completed_at",
        limit: 50,
      }),
      completedCount: this.countEntries({ delegatable: true, status: "done" }),
      unprocessed: this.getUnprocessed(20),
      humanTasks: this.listEntries({ type: "task", status: "pending", limit: 50 }),
      pendingDecisions: this.listEntries({ type: "task", status: "pending", limit: 100 }).filter(
        (e) => e.decision_options && e.decision_options.length > 0 && e.decision_selected == null,
      ),
    };
  }

  /**
   * Get weekly report data for AI-powered review generation.
   * Returns completed tasks, newly added entries, stale pending tasks,
   * tag breakdown, and overall stats for the past week.
   */
  getWeeklyReportData(asOfDate?: string) {
    const now = asOfDate ? new Date(asOfDate) : new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const sinceISO = weekAgo.toISOString();
    const untilISO = now.toISOString();

    // Tasks completed this week (by completed_at)
    const completedThisWeek = this.repository
      .list({
        status: "done",
        sort: "completed_at",
        limit: 200,
      })
      .filter((e) => e.completed_at && e.completed_at >= sinceISO && e.completed_at < untilISO);

    // Entries added this week (by created_at)
    const addedThisWeek = this.repository.list({
      since: sinceISO,
      until: untilISO,
      limit: 200,
    });

    // Pending tasks older than 7 days (stale)
    const stillPending = this.repository
      .list({
        type: "task",
        status: "pending",
        limit: 200,
      })
      .filter((e) => e.created_at < sinceISO);

    // Tag breakdown of completed tasks this week
    const tagBreakdown = this.repository.getCompletedTagBreakdown(sinceISO, untilISO);

    // Overall stats
    const stats = this.repository.getStats();

    return {
      period: {
        since: sinceISO,
        until: untilISO,
      },
      completedThisWeek,
      addedThisWeek,
      stillPending,
      tagBreakdown,
      stats,
    };
  }

  /**
   * Get today's briefing data: overdue tasks, tasks due today,
   * urgent pending tasks, and tasks completed yesterday.
   * Designed for morning AI briefing to present 3-5 actionable items.
   */
  getTodayBriefingData(today?: string): {
    overdue: Entry[];
    dueToday: Entry[];
    urgent: Entry[];
    completedYesterday: Entry[];
  } {
    const todayStr = today ?? new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(`${todayStr}T00:00:00Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    // Overdue: pending tasks with due_date before today
    const overdue = this.getOverdueTasks(todayStr);

    // Due today: pending tasks with due_date = today
    const dueToday = this.listEntries({
      type: "task",
      status: "pending",
      since: todayStr,
      until: `${todayStr}T23:59:59`,
    }).filter((e) => e.due_date?.startsWith(todayStr));

    // Urgent: pending tasks marked urgent (exclude already captured in overdue/dueToday)
    const overdueAndDueTodayIds = new Set([
      ...overdue.map((e) => e.id),
      ...dueToday.map((e) => e.id),
    ]);
    const allUrgent = this.listEntries({
      type: "task",
      status: "pending",
    }).filter((e) => e.urgent && !overdueAndDueTodayIds.has(e.id));

    // Completed yesterday: tasks completed since yesterday
    const completedYesterday = this.listEntries({
      type: "task",
      status: "done",
      sort: "completed_at",
    }).filter(
      (e) =>
        e.completed_at !== null &&
        e.completed_at >= yesterdayStr &&
        e.completed_at < `${todayStr}T00:00:00`,
    );

    return {
      overdue,
      dueToday,
      urgent: allUrgent,
      completedYesterday,
    };
  }

  runDueScheduledTasks(): Entry[] {
    const repo = this.ensureScheduledTaskRepo();
    const dueTasks = repo.getDue();
    const createdEntries: Entry[] = [];
    for (const task of dueTasks) {
      try {
        const entry = this.repository.runInTransaction(() => {
          const created = this.createEntry({ raw_text: task.raw_text });
          repo.markRun(task.id);
          return created;
        });
        createdEntries.push(entry);
      } catch (err) {
        console.error(`Failed to run scheduled task ${task.id}:`, err);
        // Continue with remaining tasks instead of aborting
      }
    }
    return createdEntries;
  }
}
