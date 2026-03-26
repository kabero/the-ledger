import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import { EntryRepository } from "./repository.js";
import { EntryService } from "./service.js";

function createTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theledger-svc-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  return createDatabase(dbPath);
}

describe("EntryService", () => {
  let db: Database.Database;
  let repo: EntryRepository;
  let service: EntryService;

  beforeEach(() => {
    db = createTestDb();
    repo = new EntryRepository(db);
    service = new EntryService(repo);
  });

  // ─── tag normalization ──────────────────────────────────

  describe("tag normalization", () => {
    it("lowercases tags on createEntry", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "note",
        title: "Test",
        tags: ["UI", "UX", "Bug"],
      });
      expect(entry.tags.sort()).toEqual(["bug", "ui", "ux"]);
    });

    it("deduplicates tags (case-insensitive)", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "note",
        title: "Test",
        tags: ["UI", "ui", "Ui"],
      });
      expect(entry.tags).toEqual(["ui"]);
    });

    it("trims whitespace from tags", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "note",
        title: "Test",
        tags: ["  hello  ", "world  "],
      });
      expect(entry.tags).toEqual(["hello", "world"]);
    });

    it("truncates tags to 20 chars", () => {
      const longTag = "a".repeat(30);
      const entry = service.createEntry({
        raw_text: "test",
        type: "note",
        title: "Test",
        tags: [longTag],
      });
      expect(entry.tags[0]).toHaveLength(20);
    });

    it("removes empty tags", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "note",
        title: "Test",
        tags: ["valid", "", "  ", "also-valid"],
      });
      expect(entry.tags.sort()).toEqual(["also-valid", "valid"]);
    });

    it("normalizes tags on submitProcessed", () => {
      const raw = service.createEntry({ raw_text: "unprocessed" });
      const processed = service.submitProcessed({
        id: raw.id,
        type: "task",
        title: "Test",
        tags: ["UI", "UX"],
        urgent: false,
        due_date: null,
        delegatable: false,
      });
      expect(processed.tags).toEqual(["ui", "ux"]);
    });

    it("normalizes tags on updateEntry", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "task",
        title: "Test",
        tags: ["original"],
      });
      const updated = service.updateEntry({
        id: entry.id,
        tags: ["NEW-Tag", "Another"],
      });
      expect(updated?.tags.sort()).toEqual(["another", "new-tag"]);
    });
  });

  // ─── decision_selected validation ───────────────────────

  describe("decision_selected validation", () => {
    it("rejects out-of-bounds decision_selected", () => {
      const entry = service.createEntry({
        raw_text: "choose",
        type: "task",
        title: "Decision",
        tags: [],
        decision_options: ["A", "B"],
      });
      expect(() => {
        service.updateEntry({ id: entry.id, decision_selected: 5 });
      }).toThrow(/out of bounds/);
    });

    it("rejects negative decision_selected", () => {
      const entry = service.createEntry({
        raw_text: "choose",
        type: "task",
        title: "Decision",
        tags: [],
        decision_options: ["A", "B"],
      });
      expect(() => {
        service.updateEntry({ id: entry.id, decision_selected: -1 });
      }).toThrow(/out of bounds/);
    });

    it("rejects decision_selected when no options exist", () => {
      const entry = service.createEntry({
        raw_text: "no options",
        type: "task",
        title: "No Options",
        tags: [],
      });
      expect(() => {
        service.updateEntry({ id: entry.id, decision_selected: 0 });
      }).toThrow(/out of bounds/);
    });

    it("accepts valid decision_selected", () => {
      const entry = service.createEntry({
        raw_text: "choose",
        type: "task",
        title: "Decision",
        tags: [],
        decision_options: ["A", "B", "C"],
      });
      const updated = service.updateEntry({ id: entry.id, decision_selected: 1 });
      expect(updated?.decision_selected).toBe(1);
    });

    it("accepts null decision_selected (clearing selection)", () => {
      const entry = service.createEntry({
        raw_text: "choose",
        type: "task",
        title: "Decision",
        tags: [],
        decision_options: ["A", "B"],
      });
      // First select
      service.updateEntry({ id: entry.id, decision_selected: 0 });
      // Then clear
      const updated = service.updateEntry({ id: entry.id, decision_selected: null });
      expect(updated?.decision_selected).toBeNull();
    });
  });
});
