import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".theledger");
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "ledger.db");

export function createDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  runMigrations(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed INTEGER NOT NULL DEFAULT 0,
      type TEXT,
      title TEXT,
      urgent INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      status TEXT,
      delegatable INTEGER NOT NULL DEFAULT 0,
      image_path TEXT,
      result TEXT,
      result_seen INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (entry_id, tag)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      raw_text,
      title,
      content='entries',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, raw_text, title)
      VALUES (new.rowid, new.raw_text, new.title);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, raw_text, title)
      VALUES ('delete', old.rowid, old.raw_text, old.title);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, raw_text, title)
      VALUES ('delete', old.rowid, old.raw_text, old.title);
      INSERT INTO entries_fts(rowid, raw_text, title)
      VALUES (new.rowid, new.raw_text, new.title);
    END;

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      frequency TEXT NOT NULL,
      day_of_week INTEGER,
      day_of_month INTEGER,
      hour INTEGER NOT NULL DEFAULT 8,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function runMigrations(db: Database.Database): void {
  const columns = db.pragma("table_info(entries)") as { name: string }[];
  const hasCol = (name: string) => columns.some((c) => c.name === name);

  if (!hasCol("delegatable")) {
    db.exec("ALTER TABLE entries ADD COLUMN delegatable INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasCol("image_path")) {
    db.exec("ALTER TABLE entries ADD COLUMN image_path TEXT");
  }
  if (!hasCol("urgent")) {
    db.exec("ALTER TABLE entries ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasCol("result")) {
    db.exec("ALTER TABLE entries ADD COLUMN result TEXT");
  }
  if (!hasCol("updated_at")) {
    db.exec("ALTER TABLE entries ADD COLUMN updated_at TEXT");
    db.exec("UPDATE entries SET updated_at = created_at WHERE updated_at IS NULL");
  }
  if (!hasCol("result_seen")) {
    db.exec("ALTER TABLE entries ADD COLUMN result_seen INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE entries SET result_seen = 1 WHERE result IS NOT NULL");
  }
  if (!hasCol("completed_at")) {
    db.exec("ALTER TABLE entries ADD COLUMN completed_at TEXT");
    db.exec(
      "UPDATE entries SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL",
    );
  }
  if (!hasCol("source")) {
    db.exec("ALTER TABLE entries ADD COLUMN source TEXT");
  }
  if (!hasCol("result_url")) {
    db.exec("ALTER TABLE entries ADD COLUMN result_url TEXT");
  }
  if (!hasCol("decision_options")) {
    db.exec("ALTER TABLE entries ADD COLUMN decision_options TEXT"); // JSON array of strings
  }
  if (!hasCol("decision_selected")) {
    db.exec("ALTER TABLE entries ADD COLUMN decision_selected INTEGER"); // index into decision_options
  }
  if (!hasCol("decision_comment")) {
    db.exec("ALTER TABLE entries ADD COLUMN decision_comment TEXT"); // free-form human comment
  }
  // migrate priority -> urgent (if priority column still exists)
  if (hasCol("priority")) {
    db.exec(
      "UPDATE entries SET urgent = CASE WHEN priority >= 4 THEN 1 ELSE 0 END WHERE priority IS NOT NULL",
    );
  }

  // --- Indexes for common query patterns ---
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
    CREATE INDEX IF NOT EXISTS idx_entries_processed ON entries(processed);
    CREATE INDEX IF NOT EXISTS idx_entries_type_status ON entries(type, status);
    CREATE INDEX IF NOT EXISTS idx_entries_delegatable ON entries(delegatable);
    CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at);
    CREATE INDEX IF NOT EXISTS idx_entries_completed_at ON entries(completed_at);
    CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
    CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag);
  `);
}
