import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  Entry,
  CreateEntryInput,
  SubmitProcessedInput,
  UpdateEntryInput,
  ListEntriesFilter,
} from "./types.js";

interface EntryRow {
  id: string;
  raw_text: string;
  created_at: string;
  processed: number;
  type: string | null;
  title: string | null;
  priority: number | null;
  due_date: string | null;
  status: string | null;
  delegatable: number;
}

export class EntryRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateEntryInput): Entry {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO entries (id, raw_text) VALUES (?, ?)`
      )
      .run(id, input.raw_text);

    return this.getById(id)!;
  }

  getById(id: string): Entry | null {
    const row = this.db
      .prepare(`SELECT * FROM entries WHERE id = ?`)
      .get(id) as EntryRow | undefined;
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
      conditions.push("EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag = ?)");
      params.push(filter.tag);
    }
    if (filter.query !== undefined) {
      conditions.push(
        "e.rowid IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)"
      );
      params.push(filter.query);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT e.* FROM entries e ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as EntryRow[];

    return rows.map((row) => this.rowToEntry(row));
  }

  getUnprocessed(limit: number = 20): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entries WHERE processed = 0 ORDER BY created_at ASC LIMIT ?`
      )
      .all(limit) as EntryRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  submitProcessed(input: SubmitProcessedInput): Entry {
    this.db
      .prepare(
        `UPDATE entries SET processed = 1, type = ?, title = ?, priority = ?, due_date = ?, status = ?, delegatable = ? WHERE id = ?`
      )
      .run(
        input.type,
        input.title,
        input.priority,
        input.due_date,
        input.type === "task" ? "pending" : null,
        input.delegatable ? 1 : 0,
        input.id
      );

    // Replace tags
    this.db.prepare(`DELETE FROM entry_tags WHERE entry_id = ?`).run(input.id);
    const insertTag = this.db.prepare(
      `INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)`
    );
    for (const tag of input.tags) {
      insertTag.run(input.id, tag);
    }

    return this.getById(input.id)!;
  }

  update(input: UpdateEntryInput): Entry | null {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.title !== undefined) {
      sets.push("title = ?");
      params.push(input.title);
    }
    if (input.priority !== undefined) {
      sets.push("priority = ?");
      params.push(input.priority);
    }
    if (input.due_date !== undefined) {
      sets.push("due_date = ?");
      params.push(input.due_date);
    }
    if (input.status !== undefined) {
      sets.push("status = ?");
      params.push(input.status);
    }
    if (input.type !== undefined) {
      sets.push("type = ?");
      params.push(input.type);
    }
    if (input.delegatable !== undefined) {
      sets.push("delegatable = ?");
      params.push(input.delegatable ? 1 : 0);
    }

    if (sets.length > 0) {
      params.push(input.id);
      this.db
        .prepare(`UPDATE entries SET ${sets.join(", ")} WHERE id = ?`)
        .run(...params);
    }

    if (input.tags !== undefined) {
      this.db.prepare(`DELETE FROM entry_tags WHERE entry_id = ?`).run(input.id);
      const insertTag = this.db.prepare(
        `INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)`
      );
      for (const tag of input.tags) {
        insertTag.run(input.id, tag);
      }
    }

    return this.getById(input.id);
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM entries WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  getTodayTasks(limit: number = 3): Entry[] {
    // Score = priority weight + due date urgency + freshness
    // Higher score = should do first
    const rows = this.db
      .prepare(
        `SELECT *,
          COALESCE(priority, 3) * 2.0 AS priority_score,
          CASE
            WHEN due_date IS NOT NULL THEN
              MAX(0, 10.0 - (julianday(due_date) - julianday('now')))
            ELSE 0
          END AS urgency_score,
          MAX(0, 5.0 - (julianday('now') - julianday(created_at))) AS freshness_score
        FROM entries
        WHERE type = 'task' AND (status IS NULL OR status = 'pending')
        ORDER BY (COALESCE(priority, 3) * 2.0 +
          CASE
            WHEN due_date IS NOT NULL THEN
              MAX(0, 10.0 - (julianday(due_date) - julianday('now')))
            ELSE 0
          END +
          MAX(0, 5.0 - (julianday('now') - julianday(created_at)))) DESC
        LIMIT ?`
      )
      .all(limit) as EntryRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  private rowToEntry(row: EntryRow): Entry {
    const tags = this.db
      .prepare(`SELECT tag FROM entry_tags WHERE entry_id = ?`)
      .all(row.id) as { tag: string }[];

    return {
      id: row.id,
      raw_text: row.raw_text,
      created_at: row.created_at,
      processed: row.processed === 1,
      type: row.type as Entry["type"],
      title: row.title,
      tags: tags.map((t) => t.tag),
      priority: row.priority,
      due_date: row.due_date,
      status: row.status as Entry["status"],
      delegatable: row.delegatable === 1,
    };
  }
}
