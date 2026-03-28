import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  CreateEntryInput,
  Entry,
  ListEntriesFilter,
  ReopenCycle,
  SubmitProcessedInput,
  UpdateEntryInput,
} from "./types.js";

interface EntryRow {
  id: string;
  raw_text: string;
  created_at: string;
  processed: number;
  type: string | null;
  title: string | null;
  urgent: number;
  due_date: string | null;
  status: string | null;
  delegatable: number;
  image_path: string | null;
  result: string | null;
  result_url: string | null;
  result_seen: number;
  updated_at: string | null;
  completed_at: string | null;
  source: string | null;
  decision_options: string | null;
  decision_selected: number | null;
  decision_comment: string | null;
  archived_at: string | null;
  parent_id: string | null;
  result_type: string | null;
  result_file: string | null;
  reopen_count: number;
}

function parseDecisionOptions(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class EntryRepository {
  constructor(private db: Database.Database) {}

  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  create(input: CreateEntryInput): Entry {
    const id = uuidv4();
    const preClassified = input.type && input.title;

    this.db
      .prepare(
        `INSERT INTO entries (id, raw_text, image_path, type, title, urgent, due_date, status, delegatable, source, result, result_url, decision_options, processed, parent_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        id,
        input.raw_text,
        input.image_path ?? null,
        input.type ?? null,
        input.title ?? null,
        input.urgent ? 1 : 0,
        input.due_date ?? null,
        preClassified && input.type === "task" ? "pending" : null,
        input.delegatable ? 1 : 0,
        input.source ?? null,
        input.result ?? null,
        input.result_url ?? null,
        input.decision_options ? JSON.stringify(input.decision_options) : null,
        preClassified ? 1 : 0,
        input.parent_id ?? null,
      );

    if (preClassified && input.tags?.length) {
      this.replaceTags(id, input.tags);
    }

    // biome-ignore lint/style/noNonNullAssertion: row just inserted
    return this.getById(id)!;
  }

  getById(id: string): Entry | null {
    const row = this.db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id) as
      | EntryRow
      | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  /**
   * Build WHERE clause conditions and params from a ListEntriesFilter.
   * Shared between list() and count() to avoid duplication.
   */
  private buildFilterClause(filter: ListEntriesFilter): {
    conditions: string[];
    params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!filter.includeArchived) {
      conditions.push("e.archived_at IS NULL");
    }
    if (filter.type !== undefined) {
      conditions.push("e.type = ?");
      params.push(filter.type);
    }
    if (filter.status !== undefined) {
      conditions.push("e.status = ?");
      params.push(filter.status);
    }
    if (filter.processed !== undefined) {
      conditions.push("e.processed = ?");
      params.push(filter.processed ? 1 : 0);
    }
    if (filter.delegatable !== undefined) {
      conditions.push("e.delegatable = ?");
      params.push(filter.delegatable ? 1 : 0);
    }
    if (filter.tag !== undefined) {
      conditions.push(
        "EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag = ?)",
      );
      params.push(filter.tag);
    }
    if (filter.query !== undefined) {
      conditions.push("e.rowid IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)");
      const sanitized = filter.query
        .replace(/"/g, '""')
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .map((t) => `"${t}"`)
        .join(" ");
      params.push(sanitized || '""');
    }
    if (filter.source !== undefined) {
      if (filter.source === "any") {
        conditions.push("e.source IS NOT NULL");
      } else {
        conditions.push("e.source = ?");
        params.push(filter.source);
      }
    }
    if (filter.since !== undefined) {
      conditions.push("e.created_at >= ?");
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      conditions.push("e.created_at < ?");
      params.push(filter.until);
    }
    if (filter.parent_id !== undefined) {
      if (filter.parent_id === null) {
        conditions.push("e.parent_id IS NULL");
      } else {
        conditions.push("e.parent_id = ?");
        params.push(filter.parent_id);
      }
    }

    return { conditions, params };
  }

  private resolveSortColumn(sort: ListEntriesFilter["sort"]): string {
    return sort === "completed_at"
      ? "e.completed_at"
      : sort === "updated_at"
        ? "e.updated_at"
        : "e.created_at";
  }

  list(filter: ListEntriesFilter = {}): Entry[] {
    const { conditions, params } = this.buildFilterClause(filter);
    const sortCol = this.resolveSortColumn(filter.sort);

    // Cursor-based pagination: decode cursor as "sortValue|rowid"
    if (filter.cursor !== undefined) {
      const sepIdx = filter.cursor.lastIndexOf("|");
      if (sepIdx > 0) {
        const cursorSort = filter.cursor.slice(0, sepIdx);
        const cursorRowid = filter.cursor.slice(sepIdx + 1);
        conditions.push(`(${sortCol} < ? OR (${sortCol} = ? AND e.rowid < ?))`);
        params.push(cursorSort, cursorSort, Number(cursorRowid));
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    // Use offset only when cursor is not provided (backward compat)
    const offset = filter.cursor !== undefined ? 0 : (filter.offset ?? 0);

    // Secondary sort: use rowid as tiebreaker for created_at (preserves insertion order),
    // and created_at+rowid for other sorts
    const secondarySort =
      sortCol === "e.created_at" ? "e.rowid DESC" : "e.created_at DESC, e.rowid DESC";

    const rows = this.db
      .prepare(
        `SELECT e.* FROM entries e ${where} ORDER BY ${sortCol} DESC, ${secondarySort} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as EntryRow[];

    return this.rowsToEntries(rows);
  }

  /**
   * List entries with cursor-based pagination, returning a nextCursor for the next page.
   * Prefer this over list() when building paginated APIs.
   */
  listWithCursor(filter: ListEntriesFilter = {}): { entries: Entry[]; nextCursor: string | null } {
    const { conditions, params } = this.buildFilterClause(filter);
    const sortCol = this.resolveSortColumn(filter.sort);

    if (filter.cursor !== undefined) {
      const sepIdx = filter.cursor.lastIndexOf("|");
      if (sepIdx > 0) {
        const cursorSort = filter.cursor.slice(0, sepIdx);
        const cursorRowid = filter.cursor.slice(sepIdx + 1);
        conditions.push(`(${sortCol} < ? OR (${sortCol} = ? AND e.rowid < ?))`);
        params.push(cursorSort, cursorSort, Number(cursorRowid));
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;

    const secondarySort =
      sortCol === "e.created_at" ? "e.rowid DESC" : "e.created_at DESC, e.rowid DESC";

    // Fetch one extra row to determine if there's a next page
    const rows = this.db
      .prepare(
        `SELECT e.*, e.rowid as _rowid FROM entries e ${where} ORDER BY ${sortCol} DESC, ${secondarySort} LIMIT ?`,
      )
      .all(...params, limit + 1) as (EntryRow & { _rowid: number })[];

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && resultRows.length > 0) {
      const lastRow = resultRows[resultRows.length - 1];
      const sortValue =
        sortCol === "e.completed_at"
          ? lastRow.completed_at
          : sortCol === "e.updated_at"
            ? lastRow.updated_at
            : lastRow.created_at;
      nextCursor = `${sortValue}|${lastRow._rowid}`;
    }

    return { entries: this.rowsToEntries(resultRows), nextCursor };
  }

  getUnprocessed(limit: number = 20): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entries WHERE processed = 0 AND archived_at IS NULL ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit) as EntryRow[];
    return this.rowsToEntries(rows);
  }

  submitProcessed(input: SubmitProcessedInput): Entry {
    return this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE entries SET processed = 1, type = ?, title = ?, urgent = ?, due_date = ?, delegatable = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(
          input.type,
          input.title,
          input.urgent ? 1 : 0,
          input.due_date,
          input.delegatable ? 1 : 0,
          input.id,
        );

      // Set status to "pending" for tasks or delegatable entries that aren't already done
      const current = this.db.prepare("SELECT status FROM entries WHERE id = ?").get(input.id) as
        | { status: string | null }
        | undefined;
      if (
        (input.type === "task" || input.delegatable) &&
        (!current?.status || current.status !== "done")
      ) {
        this.db.prepare("UPDATE entries SET status = 'pending' WHERE id = ?").run(input.id);
      }

      this.replaceTags(input.id, input.tags);

      // biome-ignore lint/style/noNonNullAssertion: row just updated
      return this.getById(input.id)!;
    })();
  }

  update(input: UpdateEntryInput): Entry | null {
    return this.db.transaction(() => {
      const sets: string[] = [];
      const params: unknown[] = [];

      if (input.title !== undefined) {
        sets.push("title = ?");
        params.push(input.title);
      }
      if (input.urgent !== undefined) {
        sets.push("urgent = ?");
        params.push(input.urgent ? 1 : 0);
      }
      if (input.due_date !== undefined) {
        sets.push("due_date = ?");
        params.push(input.due_date);
      }
      if (input.status !== undefined) {
        sets.push("status = ?");
        params.push(input.status);
        if (input.status === "done") {
          sets.push("completed_at = datetime('now')");
        } else {
          sets.push("completed_at = NULL");
        }
      }
      if (input.type !== undefined) {
        sets.push("type = ?");
        params.push(input.type);
      }
      if (input.delegatable !== undefined) {
        sets.push("delegatable = ?");
        params.push(input.delegatable ? 1 : 0);
      }
      if (input.result !== undefined) {
        sets.push("result = ?");
        params.push(input.result);
        sets.push("result_seen = 0");
      }
      if (input.result_url !== undefined) {
        sets.push("result_url = ?");
        params.push(input.result_url);
      }
      if (input.result_seen !== undefined) {
        sets.push("result_seen = ?");
        params.push(input.result_seen ? 1 : 0);
      }
      if (input.decision_selected !== undefined) {
        // Validate decision_selected is within bounds of decision_options
        if (input.decision_selected !== null) {
          const currentRow = this.db
            .prepare("SELECT decision_options FROM entries WHERE id = ?")
            .get(input.id) as { decision_options: string | null } | undefined;
          const options = parseDecisionOptions(currentRow?.decision_options ?? null);
          if (
            !options ||
            input.decision_selected < 0 ||
            input.decision_selected >= options.length
          ) {
            throw new Error(
              `decision_selected index ${input.decision_selected} is out of bounds (options length: ${options?.length ?? 0})`,
            );
          }
        }
        sets.push("decision_selected = ?");
        params.push(input.decision_selected);
      }
      if (input.decision_comment !== undefined) {
        sets.push("decision_comment = ?");
        params.push(input.decision_comment);
      }
      if (input.image_path !== undefined) {
        sets.push("image_path = ?");
        params.push(input.image_path);
      }

      sets.push("updated_at = datetime('now')");
      if (sets.length > 0) {
        params.push(input.id);
        this.db.prepare(`UPDATE entries SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      }

      if (input.tags !== undefined) {
        this.replaceTags(input.id, input.tags);
      }

      return this.getById(input.id);
    })();
  }

  markAllResultsSeen(): number {
    const result = this.db
      .prepare(
        "UPDATE entries SET result_seen = 1, updated_at = datetime('now') WHERE result IS NOT NULL AND result_seen = 0 AND archived_at IS NULL",
      )
      .run();
    return result.changes;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE entries SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND archived_at IS NULL",
      )
      .run(id);
    return result.changes > 0;
  }

  hardDelete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM entries WHERE id = ?").run(id);
    return result.changes > 0;
  }

  restore(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE entries SET archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND archived_at IS NOT NULL",
      )
      .run(id);
    return result.changes > 0;
  }

  count(filter: ListEntriesFilter = {}): number {
    const { conditions, params } = this.buildFilterClause(filter);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM entries e ${where}`)
      .get(...params) as { cnt: number };
    return row.cnt;
  }

  /**
   * Bulk-update status for multiple entries in a single transaction.
   * Returns the number of entries actually updated.
   */
  bulkUpdateStatus(ids: string[], status: "pending" | "done"): number {
    if (ids.length === 0) return 0;
    return this.db.transaction(() => {
      let count = 0;
      const completedClause =
        status === "done" ? ", completed_at = datetime('now')" : ", completed_at = NULL";
      const stmt = this.db.prepare(
        `UPDATE entries SET status = ?, updated_at = datetime('now')${completedClause} WHERE id = ?`,
      );
      for (const id of ids) {
        const result = stmt.run(status, id);
        count += result.changes;
      }
      return count;
    })();
  }

  /**
   * Bulk-delete multiple entries in a single transaction.
   * Returns the number of entries actually deleted.
   */
  bulkDelete(ids: string[]): number {
    if (ids.length === 0) return 0;
    return this.db.transaction(() => {
      let count = 0;
      const stmt = this.db.prepare(
        "UPDATE entries SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND archived_at IS NULL",
      );
      for (const id of ids) {
        const result = stmt.run(id);
        count += result.changes;
      }
      return count;
    })();
  }

  /**
   * Get pending tasks whose due_date is before the given date (YYYY-MM-DD).
   * Useful for overdue task detection.
   */
  getOverdueTasks(beforeDate: string): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entries
         WHERE type = 'task'
           AND status = 'pending'
           AND due_date IS NOT NULL
           AND due_date < ?
           AND archived_at IS NULL
         ORDER BY due_date ASC`,
      )
      .all(beforeDate) as EntryRow[];
    return this.rowsToEntries(rows);
  }

  /**
   * Get a summary of entry counts grouped by type.
   */
  getTypeSummary(): { type: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT type, COUNT(*) as count FROM entries WHERE type IS NOT NULL AND archived_at IS NULL GROUP BY type ORDER BY count DESC`,
      )
      .all() as { type: string; count: number }[];
  }

  getUnseenResultCount(): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM entries WHERE result IS NOT NULL AND result_seen = 0 AND archived_at IS NULL",
      )
      .get() as { cnt: number };
    return row.cnt;
  }

  getPendingDecisionCount(): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM entries WHERE decision_options IS NOT NULL AND decision_options != '[]' AND decision_selected IS NULL AND (status IS NULL OR status = 'pending') AND archived_at IS NULL",
      )
      .get() as { cnt: number };
    return row.cnt;
  }

  getByIds(ids: string[]): Entry[] {
    if (ids.length === 0) return [];
    const CHUNK_SIZE = 100;
    const allRows: EntryRow[] = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.db
        .prepare(`SELECT * FROM entries WHERE id IN (${placeholders})`)
        .all(...chunk) as EntryRow[];
      allRows.push(...rows);
    }
    return this.rowsToEntries(allRows);
  }

  getTagVocabulary(): { tag: string; count: number }[] {
    return this.db
      .prepare("SELECT tag, COUNT(*) as count FROM entry_tags GROUP BY tag ORDER BY count DESC")
      .all() as { tag: string; count: number }[];
  }

  /**
   * Get tag breakdown of completed entries within a date range.
   * Returns tags with their completion counts, sorted by count descending.
   */
  getCompletedTagBreakdown(since: string, until: string): { tag: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT et.tag, COUNT(*) as count
         FROM entry_tags et
         JOIN entries e ON e.id = et.entry_id
         WHERE e.completed_at IS NOT NULL
           AND e.completed_at >= ?
           AND e.completed_at < ?
           AND e.archived_at IS NULL
         GROUP BY et.tag
         ORDER BY count DESC`,
      )
      .all(since, until) as { tag: string; count: number }[];
  }

  /**
   * Rename a tag across all entries. Handles conflicts: if an entry already has
   * the new tag, the old tag row is simply deleted instead of creating a duplicate.
   * Returns the number of entries that were affected.
   */
  bulkTagRename(oldTag: string, newTag: string): number {
    return this.db.transaction(() => {
      // Find entries that have the old tag
      const rows = this.db.prepare("SELECT entry_id FROM entry_tags WHERE tag = ?").all(oldTag) as {
        entry_id: string;
      }[];

      if (rows.length === 0) return 0;

      let affected = 0;
      for (const row of rows) {
        // Check if entry already has the new tag
        const existing = this.db
          .prepare("SELECT 1 FROM entry_tags WHERE entry_id = ? AND tag = ?")
          .get(row.entry_id, newTag);

        // Delete the old tag
        this.db
          .prepare("DELETE FROM entry_tags WHERE entry_id = ? AND tag = ?")
          .run(row.entry_id, oldTag);

        // Insert new tag only if it doesn't already exist
        if (!existing) {
          this.db
            .prepare("INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)")
            .run(row.entry_id, newTag);
        }

        // Touch updated_at
        this.db
          .prepare("UPDATE entries SET updated_at = datetime('now') WHERE id = ?")
          .run(row.entry_id);

        affected++;
      }
      return affected;
    })();
  }

  getStats(): {
    streak: number;
    weeklyCompletions: { week: string; count: number }[];
    leadTimeDistribution: { bucket: string; count: number }[];
    hourlyCompletions: { hour: number; count: number }[];
  } {
    // 1. Streak: 今日から遡って連続で完了タスクがある日数
    const streakRows = this.db
      .prepare(
        `SELECT DISTINCT date(completed_at, 'localtime') AS d
         FROM entries
         WHERE completed_at IS NOT NULL
           AND completed_at >= datetime('now', '-365 days')
         ORDER BY d DESC`,
      )
      .all() as { d: string }[];

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < streakRows.length; i++) {
      const expected = new Date(today);
      expected.setDate(expected.getDate() - i);
      const expectedStr = expected.toISOString().slice(0, 10);
      if (streakRows[i].d === expectedStr) {
        streak++;
      } else {
        break;
      }
    }

    // 2. Weekly completions: 過去4週分
    const weeklyRows = this.db
      .prepare(
        `SELECT
           CAST((julianday('now', 'localtime', 'start of day') - julianday(date(completed_at, 'localtime'))) / 7 AS INTEGER) AS week_ago,
           COUNT(*) AS count
         FROM entries
         WHERE completed_at IS NOT NULL
           AND date(completed_at, 'localtime') >= date('now', 'localtime', '-27 days')
         GROUP BY week_ago
         ORDER BY week_ago DESC`,
      )
      .all() as { week_ago: number; count: number }[];

    const weeklyMap = new Map<number, number>();
    for (const row of weeklyRows) {
      weeklyMap.set(row.week_ago, row.count);
    }
    const weeklyCompletions: { week: string; count: number }[] = [];
    for (let w = 3; w >= 0; w--) {
      const start = new Date(today);
      start.setDate(start.getDate() - w * 7);
      // 週の開始日のラベル (M/D)
      const label = `${start.getMonth() + 1}/${start.getDate()}`;
      weeklyCompletions.push({ week: label, count: weeklyMap.get(w) ?? 0 });
    }

    // 3. Lead time distribution
    const leadRows = this.db
      .prepare(
        `SELECT
           CAST(julianday(completed_at) - julianday(created_at) AS INTEGER) AS days
         FROM entries
         WHERE completed_at IS NOT NULL
           AND completed_at >= datetime('now', '-365 days')`,
      )
      .all() as { days: number }[];

    const buckets = ["当日", "1日", "2-3日", "4-7日", "8日以上"];
    const bucketCounts = [0, 0, 0, 0, 0];
    for (const row of leadRows) {
      const d = row.days;
      if (d <= 0) bucketCounts[0]++;
      else if (d === 1) bucketCounts[1]++;
      else if (d <= 3) bucketCounts[2]++;
      else if (d <= 7) bucketCounts[3]++;
      else bucketCounts[4]++;
    }
    const leadTimeDistribution = buckets.map((bucket, i) => ({
      bucket,
      count: bucketCounts[i],
    }));

    // 4. Hourly completions
    const hourlyRows = this.db
      .prepare(
        `SELECT
           CAST(strftime('%H', completed_at, 'localtime') AS INTEGER) AS hour,
           COUNT(*) AS count
         FROM entries
         WHERE completed_at IS NOT NULL
         GROUP BY hour`,
      )
      .all() as { hour: number; count: number }[];

    const hourlyMap = new Map<number, number>();
    for (const row of hourlyRows) {
      hourlyMap.set(row.hour, row.count);
    }
    const hourlyCompletions: { hour: number; count: number }[] = [];
    for (let h = 0; h < 24; h++) {
      hourlyCompletions.push({ hour: h, count: hourlyMap.get(h) ?? 0 });
    }

    return { streak, weeklyCompletions, leadTimeDistribution, hourlyCompletions };
  }

  /**
   * Archive (delete) completed tasks older than the given number of days.
   * Returns the number of entries deleted.
   */
  archiveCompleted(olderThanDays: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM entries
         WHERE status = 'done'
           AND completed_at IS NOT NULL
           AND completed_at < datetime('now', ?)`,
      )
      .run(`-${olderThanDays} days`);
    return result.changes;
  }

  /**
   * Check if an entry with similar raw_text already exists (exact match).
   * Useful for deduplication before creating new entries.
   */
  findDuplicate(rawText: string): Entry | null {
    const row = this.db
      .prepare(
        "SELECT * FROM entries WHERE raw_text = ? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(rawText) as EntryRow | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  /**
   * Delete all entries of type 'trash'. Returns count of deleted entries.
   */
  purgeTrash(): number {
    const result = this.db.prepare("DELETE FROM entries WHERE type = 'trash'").run();
    return result.changes;
  }

  /**
   * Get a timeline of recent activity: newly created, completed, and decision entries.
   * Returns entries sorted by their most relevant timestamp descending.
   */
  getRecentActivity(limit: number = 20): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entries
         WHERE processed = 1 AND type IS NOT NULL AND archived_at IS NULL
         ORDER BY
           COALESCE(completed_at, updated_at, created_at) DESC
         LIMIT ?`,
      )
      .all(limit) as EntryRow[];
    return this.rowsToEntries(rows);
  }

  /**
   * Get subtasks (children) of a given parent entry.
   */
  getSubtasks(parentId: string): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entries WHERE parent_id = ? AND archived_at IS NULL ORDER BY created_at ASC`,
      )
      .all(parentId) as EntryRow[];
    return this.rowsToEntries(rows);
  }

  /**
   * Rebuild the FTS index from scratch. Useful after bulk operations
   * or if the index gets out of sync.
   */
  rebuildFtsIndex(): void {
    this.db.transaction(() => {
      // Delete all FTS content
      this.db.exec("INSERT INTO entries_fts(entries_fts) VALUES('delete-all')");
      // Re-insert from entries table
      this.db.exec(`
        INSERT INTO entries_fts(rowid, raw_text, title)
        SELECT rowid, raw_text, title FROM entries
      `);
    })();
  }

  addHistoryEntry(
    entryId: string,
    result: string,
    resultType: string | null,
    feedback: string,
    completedAt: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO entry_history (id, entry_id, result, result_type, feedback, completed_at, reopened_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(uuidv4(), entryId, result, resultType, feedback, completedAt, new Date().toISOString());
  }

  incrementReopenCount(id: string): void {
    this.db
      .prepare(
        "UPDATE entries SET reopen_count = reopen_count + 1, completed_at = NULL WHERE id = ?",
      )
      .run(id);
  }

  getEntryHistory(entryId: string): ReopenCycle[] {
    return this.db
      .prepare("SELECT * FROM entry_history WHERE entry_id = ? ORDER BY reopened_at DESC")
      .all(entryId) as ReopenCycle[];
  }

  private replaceTags(entryId: string, tags: string[]): void {
    this.db.prepare(`DELETE FROM entry_tags WHERE entry_id = ?`).run(entryId);
    const insertTag = this.db.prepare(`INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)`);
    const seen = new Set<string>();
    for (const tag of tags) {
      const trimmed = tag.slice(0, 20); // enforce max 20 chars
      if (trimmed.length === 0) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      insertTag.run(entryId, trimmed);
    }
  }

  private rowsToEntries(rows: EntryRow[]): Entry[] {
    if (rows.length === 0) return [];

    // Fetch tags in chunks to avoid SQLite SQLITE_MAX_VARIABLE_NUMBER limit
    const CHUNK_SIZE = 100;
    const ids = rows.map((r) => r.id);
    const tagMap = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const tagRows = this.db
        .prepare(`SELECT entry_id, tag FROM entry_tags WHERE entry_id IN (${placeholders})`)
        .all(...chunk) as { entry_id: string; tag: string }[];
      for (const t of tagRows) {
        const arr = tagMap.get(t.entry_id);
        if (arr) {
          arr.push(t.tag);
        } else {
          tagMap.set(t.entry_id, [t.tag]);
        }
      }
    }

    return rows.map((row) => ({
      id: row.id,
      raw_text: row.raw_text,
      created_at: row.created_at,
      processed: row.processed === 1,
      type: row.type as Entry["type"],
      title: row.title,
      tags: tagMap.get(row.id) ?? [],
      urgent: row.urgent === 1,
      due_date: row.due_date,
      status: row.status as Entry["status"],
      delegatable: row.delegatable === 1,
      image_path: row.image_path ?? null,
      result: row.result ?? null,
      result_url: row.result_url ?? null,
      result_seen: row.result_seen === 1,
      completed_at: row.completed_at ?? null,
      source: row.source ?? null,
      decision_options: parseDecisionOptions(row.decision_options),
      decision_selected: row.decision_selected ?? null,
      decision_comment: row.decision_comment ?? null,
      archived_at: row.archived_at ?? null,
      parent_id: row.parent_id ?? null,
      result_type: row.result_type ?? null,
      result_file: row.result_file ?? null,
      reopen_count: row.reopen_count ?? 0,
    }));
  }

  private rowToEntry(row: EntryRow): Entry {
    const tags = this.db.prepare(`SELECT tag FROM entry_tags WHERE entry_id = ?`).all(row.id) as {
      tag: string;
    }[];

    return {
      id: row.id,
      raw_text: row.raw_text,
      created_at: row.created_at,
      processed: row.processed === 1,
      type: row.type as Entry["type"],
      title: row.title,
      tags: tags.map((t) => t.tag),
      urgent: row.urgent === 1,
      due_date: row.due_date,
      status: row.status as Entry["status"],
      delegatable: row.delegatable === 1,
      image_path: row.image_path ?? null,
      result: row.result ?? null,
      result_url: row.result_url ?? null,
      result_seen: row.result_seen === 1,
      completed_at: row.completed_at ?? null,
      source: row.source ?? null,
      decision_options: parseDecisionOptions(row.decision_options),
      decision_selected: row.decision_selected ?? null,
      decision_comment: row.decision_comment ?? null,
      archived_at: row.archived_at ?? null,
      parent_id: row.parent_id ?? null,
      result_type: row.result_type ?? null,
      result_file: row.result_file ?? null,
      reopen_count: row.reopen_count ?? 0,
    };
  }
}
