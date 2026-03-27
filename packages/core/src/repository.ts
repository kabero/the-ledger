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
  result_seen: number;
  updated_at: string | null;
  completed_at: string | null;
}

export class EntryRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateEntryInput): Entry {
    const id = uuidv4();
    if (input.image_path) {
      this.db
        .prepare(
          `INSERT INTO entries (id, raw_text, image_path, updated_at) VALUES (?, ?, ?, datetime('now'))`,
        )
        .run(id, input.raw_text, input.image_path);
    } else {
      this.db
        .prepare(`INSERT INTO entries (id, raw_text, updated_at) VALUES (?, ?, datetime('now'))`)
        .run(id, input.raw_text);
    }

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
      params.push(filter.query);
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
    this.db
      .prepare(
        `UPDATE entries SET processed = 1, type = ?, title = ?, urgent = ?, due_date = ?, status = ?, delegatable = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        input.type,
        input.title,
        input.urgent ? 1 : 0,
        input.due_date,
        input.type === "task" ? "pending" : null,
        input.delegatable ? 1 : 0,
        input.id,
      );

    this.replaceTags(input.id, input.tags);

    return this.getById(input.id)!;
  }

  update(input: UpdateEntryInput): Entry | null {
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
    if (input.result_seen !== undefined) {
      sets.push("result_seen = ?");
      params.push(input.result_seen ? 1 : 0);
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
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM entries WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  getTodayTasks(limit: number = 3): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT *,
          urgent * 10.0 AS urgent_score,
          CASE
            WHEN due_date IS NOT NULL THEN
              MAX(0, 10.0 - (julianday(due_date) - julianday('now')))
            ELSE 0
          END AS due_score,
          MAX(0, 5.0 - (julianday('now') - julianday(created_at))) AS freshness_score
        FROM entries
        WHERE type = 'task' AND (status IS NULL OR status = 'pending')
        ORDER BY (urgent * 10.0 +
          CASE
            WHEN due_date IS NOT NULL THEN
              MAX(0, 10.0 - (julianday(due_date) - julianday('now')))
            ELSE 0
          END +
          MAX(0, 5.0 - (julianday('now') - julianday(created_at)))) DESC
        LIMIT ?`,
      )
      .all(limit) as EntryRow[];
    return this.rowsToEntries(rows);
  }

  private replaceTags(entryId: string, tags: string[]): void {
    this.db.prepare(`DELETE FROM entry_tags WHERE entry_id = ?`).run(entryId);
    const insertTag = this.db.prepare(`INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)`);
    for (const tag of tags) {
      insertTag.run(entryId, tag);
    }
  }

  private rowsToEntries(rows: EntryRow[]): Entry[] {
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(", ");
    const tagRows = this.db
      .prepare(`SELECT entry_id, tag FROM entry_tags WHERE entry_id IN (${placeholders})`)
      .all(...ids) as { entry_id: string; tag: string }[];

    const tagMap = new Map<string, string[]>();
    for (const t of tagRows) {
      const arr = tagMap.get(t.entry_id);
      if (arr) {
        arr.push(t.tag);
      } else {
        tagMap.set(t.entry_id, [t.tag]);
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
      result_seen: row.result_seen === 1,
      completed_at: row.completed_at ?? null,
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
      result_seen: row.result_seen === 1,
      completed_at: row.completed_at ?? null,
    };
  }
}
