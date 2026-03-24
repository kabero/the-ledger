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
      priority INTEGER,
      due_date TEXT,
      status TEXT,
      delegatable INTEGER NOT NULL DEFAULT 0,
      image_path TEXT
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
}
