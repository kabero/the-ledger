import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduleFrequency,
  UpdateScheduledTaskInput,
} from "./types.js";

interface ScheduledTaskRow {
  id: string;
  raw_text: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  hour: number;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
}

export class ScheduledTaskRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateScheduledTaskInput): ScheduledTask {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO scheduled_tasks (id, raw_text, frequency, day_of_week, day_of_month, hour)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.raw_text,
        input.frequency,
        input.day_of_week ?? null,
        input.day_of_month ?? null,
        input.hour ?? 8,
      );
    // biome-ignore lint/style/noNonNullAssertion: row just inserted
    return this.getById(id)!;
  }

  list(): ScheduledTask[] {
    const rows = this.db
      .prepare(`SELECT * FROM scheduled_tasks ORDER BY created_at DESC`)
      .all() as ScheduledTaskRow[];
    return rows.map((row) => this.rowToEntity(row));
  }

  getById(id: string): ScheduledTask | null {
    const row = this.db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id) as
      | ScheduledTaskRow
      | undefined;
    if (!row) return null;
    return this.rowToEntity(row);
  }

  update(input: UpdateScheduledTaskInput): ScheduledTask | null {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.raw_text !== undefined) {
      sets.push("raw_text = ?");
      params.push(input.raw_text);
    }
    if (input.frequency !== undefined) {
      sets.push("frequency = ?");
      params.push(input.frequency);
    }
    if (input.day_of_week !== undefined) {
      sets.push("day_of_week = ?");
      params.push(input.day_of_week);
    }
    if (input.day_of_month !== undefined) {
      sets.push("day_of_month = ?");
      params.push(input.day_of_month);
    }
    if (input.hour !== undefined) {
      sets.push("hour = ?");
      params.push(input.hour);
    }
    if (input.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(input.enabled ? 1 : 0);
    }

    if (sets.length === 0) {
      return this.getById(input.id);
    }

    params.push(input.id);
    this.db.prepare(`UPDATE scheduled_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);

    return this.getById(input.id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  getDue(): ScheduledTask[] {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDayOfWeek = now.getDay();
    const currentDayOfMonth = now.getDate();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_tasks
         WHERE enabled = 1
           AND hour = ?
           AND (last_run_at IS NULL OR date(last_run_at) < ?)
           AND (
             frequency = 'daily'
             OR (frequency = 'weekly' AND day_of_week = ?)
             OR (frequency = 'monthly' AND day_of_month = ?)
           )`,
      )
      .all(currentHour, todayStr, currentDayOfWeek, currentDayOfMonth) as ScheduledTaskRow[];

    return rows.map((row) => this.rowToEntity(row));
  }

  markRun(id: string): void {
    this.db
      .prepare(`UPDATE scheduled_tasks SET last_run_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  private rowToEntity(row: ScheduledTaskRow): ScheduledTask {
    return {
      id: row.id,
      raw_text: row.raw_text,
      frequency: row.frequency as ScheduleFrequency,
      day_of_week: row.day_of_week,
      day_of_month: row.day_of_month,
      hour: row.hour,
      enabled: row.enabled === 1,
      last_run_at: row.last_run_at,
      created_at: row.created_at,
    };
  }
}
