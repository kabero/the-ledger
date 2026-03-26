import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  CreateEntryInput,
  Entry,
  ListEntriesFilter,
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
        `INSERT INTO entries (id, raw_text, image_path, type, title, urgent, due_date, status, delegatable, source, result, result_url, decision_options, processed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
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

  list(filter: ListEntriesFilter = {}): Entry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

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
      // Sanitize FTS5 query: wrap each term in double quotes to escape special syntax
      const sanitized = filter.query
        .replace(/"/g, '""') // escape existing double quotes
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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const sortCol =
      filter.sort === "completed_at"
        ? "e.completed_at"
        : filter.sort === "updated_at"
          ? "e.updated_at"
          : "e.created_at";

    const rows = this.db
      .prepare(`SELECT e.* FROM entries e ${where} ORDER BY ${sortCol} DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as EntryRow[];

    return this.rowsToEntries(rows);
  }

  getUnprocessed(limit: number = 20): Entry[] {
    const rows = this.db
      .prepare(`SELECT * FROM entries WHERE processed = 0 ORDER BY created_at ASC LIMIT ?`)
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

      // Set status to "pending" only for tasks that don't already have a status
      const current = this.db.prepare("SELECT status FROM entries WHERE id = ?").get(input.id) as
        | { status: string | null }
        | undefined;
      if (input.type === "task" && (!current?.status || current.status !== "done")) {
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
        "UPDATE entries SET result_seen = 1, updated_at = datetime('now') WHERE result IS NOT NULL AND result_seen = 0",
      )
      .run();
    return result.changes;
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM entries WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  count(filter: ListEntriesFilter = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM entries e ${where}`)
      .get(...params) as { cnt: number };
    return row.cnt;
  }

  getTagVocabulary(): { tag: string; count: number }[] {
    return this.db
      .prepare("SELECT tag, COUNT(*) as count FROM entry_tags GROUP BY tag ORDER BY count DESC")
      .all() as { tag: string; count: number }[];
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
    };
  }
}
