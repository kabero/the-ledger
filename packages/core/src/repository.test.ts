import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import { EntryRepository } from "./repository.js";

function createTestDb(): Database.Database {
  // Use in-memory SQLite for fast, isolated tests
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theledger-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  return createDatabase(dbPath);
}

describe("EntryRepository", () => {
  let db: Database.Database;
  let repo: EntryRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new EntryRepository(db);
  });

  // ─── create ───────────────────────────────────────────────

  describe("create", () => {
    it("creates a raw unprocessed entry", () => {
      const entry = repo.create({ raw_text: "buy milk" });
      expect(entry.id).toBeDefined();
      expect(entry.raw_text).toBe("buy milk");
      expect(entry.processed).toBe(false);
      expect(entry.type).toBeNull();
      expect(entry.title).toBeNull();
      expect(entry.tags).toEqual([]);
      expect(entry.status).toBeNull();
      expect(entry.urgent).toBe(false);
      expect(entry.delegatable).toBe(false);
    });

    it("creates a pre-classified entry with tags", () => {
      const entry = repo.create({
        raw_text: "buy milk",
        type: "task",
        title: "Buy milk",
        tags: ["grocery", "errands"],
        urgent: true,
        delegatable: true,
      });
      expect(entry.processed).toBe(true);
      expect(entry.type).toBe("task");
      expect(entry.title).toBe("Buy milk");
      expect(entry.tags.sort()).toEqual(["errands", "grocery"]);
      expect(entry.status).toBe("pending");
      expect(entry.urgent).toBe(true);
      expect(entry.delegatable).toBe(true);
    });

    it("sets status to null for non-task pre-classified entries", () => {
      const entry = repo.create({
        raw_text: "interesting idea",
        type: "note",
        title: "An idea",
        tags: [],
      });
      expect(entry.status).toBeNull();
    });

    it("does not attach tags when not pre-classified", () => {
      const entry = repo.create({
        raw_text: "just raw text",
        tags: ["should-not-appear"],
      });
      expect(entry.tags).toEqual([]);
    });

    it("stores source field", () => {
      const entry = repo.create({
        raw_text: "from slack",
        type: "task",
        title: "Slack task",
        source: "slack",
      });
      expect(entry.source).toBe("slack");
    });

    it("stores result and result_url", () => {
      const entry = repo.create({
        raw_text: "delegatable work",
        type: "task",
        title: "Do X",
        result: "Done!",
        result_url: "https://example.com",
      });
      expect(entry.result).toBe("Done!");
      expect(entry.result_url).toBe("https://example.com");
      expect(entry.result_seen).toBe(false);
    });
  });

  // ─── getById ──────────────────────────────────────────────

  describe("getById", () => {
    it("returns entry by id", () => {
      const created = repo.create({ raw_text: "hello" });
      const fetched = repo.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(created.id);
    });

    it("returns null for non-existent id", () => {
      expect(repo.getById("nonexistent-id")).toBeNull();
    });
  });

  // ─── update (status transitions) ─────────────────────────

  describe("update", () => {
    it("sets completed_at when status changes to done", () => {
      const entry = repo.create({
        raw_text: "task",
        type: "task",
        title: "A task",
      });
      const updated = repo.update({ id: entry.id, status: "done" });
      expect(updated?.status).toBe("done");
      expect(updated?.completed_at).not.toBeNull();
    });

    it("clears completed_at when status changes from done to pending", () => {
      const entry = repo.create({
        raw_text: "task",
        type: "task",
        title: "A task",
      });
      repo.update({ id: entry.id, status: "done" });
      const updated = repo.update({ id: entry.id, status: "pending" });
      expect(updated?.status).toBe("pending");
      expect(updated?.completed_at).toBeNull();
    });

    it("updates title", () => {
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "Old",
      });
      const updated = repo.update({ id: entry.id, title: "New" });
      expect(updated?.title).toBe("New");
    });

    it("updates tags", () => {
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
        tags: ["old"],
      });
      const updated = repo.update({ id: entry.id, tags: ["new1", "new2"] });
      expect(updated?.tags).toEqual(["new1", "new2"]);
    });

    it("updates result and resets result_seen", () => {
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
      });
      repo.update({ id: entry.id, result: "first", result_seen: true });
      const updated = repo.update({ id: entry.id, result: "second" });
      expect(updated?.result).toBe("second");
      expect(updated?.result_seen).toBe(false);
    });

    it("returns null for non-existent id", () => {
      const result = repo.update({ id: "no-such-id", title: "x" });
      expect(result).toBeNull();
    });
  });

  // ─── submitProcessed ─────────────────────────────────────

  describe("submitProcessed", () => {
    it("processes a raw entry into a task", () => {
      const raw = repo.create({ raw_text: "buy milk" });
      expect(raw.processed).toBe(false);

      const processed = repo.submitProcessed({
        id: raw.id,
        type: "task",
        title: "Buy milk",
        tags: ["grocery"],
        urgent: false,
        due_date: null,
        delegatable: false,
      });

      expect(processed.processed).toBe(true);
      expect(processed.type).toBe("task");
      expect(processed.title).toBe("Buy milk");
      expect(processed.tags).toEqual(["grocery"]);
      expect(processed.status).toBe("pending");
    });

    it("does not overwrite done status when re-processing", () => {
      // Create a task and mark it done
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
      });
      repo.update({ id: entry.id, status: "done" });

      // Simulate re-processing (should not overwrite done -> pending)
      const reprocessed = repo.submitProcessed({
        id: entry.id,
        type: "task",
        title: "T updated",
        tags: [],
        urgent: false,
        due_date: null,
        delegatable: false,
      });

      expect(reprocessed.status).toBe("done");
    });

    it("processes into a note (no status set)", () => {
      const raw = repo.create({ raw_text: "just a thought" });
      const processed = repo.submitProcessed({
        id: raw.id,
        type: "note",
        title: "A thought",
        tags: ["idea"],
        urgent: false,
        due_date: null,
        delegatable: false,
      });

      expect(processed.type).toBe("note");
      expect(processed.status).toBeNull();
    });
  });

  // ─── list (filters) ──────────────────────────────────────

  describe("list", () => {
    function seedEntries() {
      repo.create({
        raw_text: "task1",
        type: "task",
        title: "Task 1",
        tags: ["work"],
        urgent: true,
      });
      repo.create({ raw_text: "task2", type: "task", title: "Task 2", tags: ["home"] });
      repo.create({ raw_text: "note1", type: "note", title: "Note 1", tags: ["work"] });
      repo.create({ raw_text: "wish1", type: "wish", title: "Wish 1" });
      repo.create({ raw_text: "unprocessed" });
    }

    it("returns all entries by default", () => {
      seedEntries();
      const entries = repo.list();
      expect(entries.length).toBe(5);
    });

    it("filters by type", () => {
      seedEntries();
      const tasks = repo.list({ type: "task" });
      expect(tasks.length).toBe(2);
      expect(tasks.every((e) => e.type === "task")).toBe(true);
    });

    it("filters by tag", () => {
      seedEntries();
      const work = repo.list({ tag: "work" });
      expect(work.length).toBe(2);
    });

    it("filters by processed", () => {
      seedEntries();
      const unprocessed = repo.list({ processed: false });
      expect(unprocessed.length).toBe(1);
      expect(unprocessed[0].raw_text).toBe("unprocessed");
    });

    it("filters by status", () => {
      seedEntries();
      const pending = repo.list({ status: "pending" });
      expect(pending.length).toBe(2); // both tasks are pending
    });

    it("filters by delegatable", () => {
      repo.create({ raw_text: "d1", type: "task", title: "D1", delegatable: true });
      repo.create({ raw_text: "d2", type: "task", title: "D2", delegatable: false });
      const delegatable = repo.list({ delegatable: true });
      expect(delegatable.length).toBe(1);
      expect(delegatable[0].title).toBe("D1");
    });

    it("filters by source", () => {
      repo.create({ raw_text: "s1", type: "task", title: "S1", source: "slack" });
      repo.create({ raw_text: "s2", type: "task", title: "S2", source: "email" });
      repo.create({ raw_text: "s3", type: "task", title: "S3" });

      expect(repo.list({ source: "slack" }).length).toBe(1);
      expect(repo.list({ source: "any" }).length).toBe(2);
    });

    it("supports limit and offset", () => {
      seedEntries();
      const first2 = repo.list({ limit: 2 });
      expect(first2.length).toBe(2);
      const next2 = repo.list({ limit: 2, offset: 2 });
      expect(next2.length).toBe(2);
      // No overlap
      expect(first2[0].id).not.toBe(next2[0].id);
    });

    it("sorts by created_at descending by default", () => {
      seedEntries();
      const entries = repo.list();
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1].created_at >= entries[i].created_at).toBe(true);
      }
    });
  });

  // ─── FTS query sanitization ───────────────────────────────

  describe("FTS query (list with query filter)", () => {
    it("finds entries by text search", () => {
      repo.create({ raw_text: "buy milk at the store", type: "task", title: "Buy milk" });
      repo.create({ raw_text: "fix the bug in auth", type: "task", title: "Fix auth bug" });
      const results = repo.list({ query: "milk" });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Buy milk");
    });

    it("handles special characters in query", () => {
      repo.create({ raw_text: "test entry", type: "note", title: "Test" });
      // These should not throw - FTS5 special chars are escaped
      expect(() => repo.list({ query: "test*" })).not.toThrow();
      expect(() => repo.list({ query: '"test"' })).not.toThrow();
      expect(() => repo.list({ query: "test OR something" })).not.toThrow();
      expect(() => repo.list({ query: "test AND something" })).not.toThrow();
      expect(() => repo.list({ query: "NOT test" })).not.toThrow();
      expect(() => repo.list({ query: "test (parens)" })).not.toThrow();
      expect(() => repo.list({ query: "a:b" })).not.toThrow();
    });

    it("handles empty query", () => {
      repo.create({ raw_text: "hello", type: "note", title: "Hello" });
      // Empty query should not throw
      expect(() => repo.list({ query: "" })).not.toThrow();
      expect(() => repo.list({ query: "   " })).not.toThrow();
    });
  });

  // ─── replaceTags boundary cases ───────────────────────────

  describe("replaceTags (via create/update)", () => {
    it("deduplicates tags", () => {
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
        tags: ["dup", "dup", "dup"],
      });
      expect(entry.tags).toEqual(["dup"]);
    });

    it("filters empty string tags", () => {
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
        tags: ["valid", "", "   "],
      });
      // Empty string is filtered; "   " gets sliced to "   " (3 spaces) which is not empty
      // Actually... let's check: trimmed = tag.slice(0, 20), "   ".slice(0,20) = "   "
      // "   ".length === 3, so it passes the length check
      // The code does NOT trim whitespace, only slices to 20 chars
      expect(entry.tags).toContain("valid");
      expect(entry.tags).not.toContain("");
    });

    it("truncates tags longer than 20 characters", () => {
      const longTag = "abcdefghijklmnopqrstuvwxyz"; // 26 chars
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
        tags: [longTag],
      });
      expect(entry.tags[0]).toBe("abcdefghijklmnopqrst"); // 20 chars
    });

    it("replaces all tags on update", () => {
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
        tags: ["old1", "old2"],
      });
      const updated = repo.update({ id: entry.id, tags: ["new1"] });
      expect(updated?.tags).toEqual(["new1"]);
    });
  });

  // ─── delete ───────────────────────────────────────────────

  describe("delete", () => {
    it("deletes an existing entry", () => {
      const entry = repo.create({ raw_text: "to delete" });
      expect(repo.delete(entry.id)).toBe(true);
      expect(repo.getById(entry.id)).toBeNull();
    });

    it("returns false for non-existent entry", () => {
      expect(repo.delete("no-such-id")).toBe(false);
    });

    it("cascades tag deletion", () => {
      const entry = repo.create({
        raw_text: "x",
        type: "task",
        title: "T",
        tags: ["a", "b"],
      });
      repo.delete(entry.id);
      const tagRows = db.prepare("SELECT * FROM entry_tags WHERE entry_id = ?").all(entry.id);
      expect(tagRows.length).toBe(0);
    });
  });

  // ─── getTagVocabulary ─────────────────────────────────────

  describe("getTagVocabulary", () => {
    it("returns tag counts sorted by count desc", () => {
      repo.create({ raw_text: "a", type: "task", title: "A", tags: ["common", "rare"] });
      repo.create({ raw_text: "b", type: "task", title: "B", tags: ["common"] });
      const vocab = repo.getTagVocabulary();
      expect(vocab[0].tag).toBe("common");
      expect(vocab[0].count).toBe(2);
      expect(vocab[1].tag).toBe("rare");
      expect(vocab[1].count).toBe(1);
    });
  });

  // ─── decision fields ───────────────────────────────────────

  describe("decision fields", () => {
    it("stores decision_options on create", () => {
      const entry = repo.create({
        raw_text: "Which color?",
        type: "task",
        title: "Choose color",
        decision_options: ["Red", "Blue", "Green"],
      });
      expect(entry.decision_options).toEqual(["Red", "Blue", "Green"]);
      expect(entry.decision_selected).toBeNull();
      expect(entry.decision_comment).toBeNull();
    });

    it("updates decision_selected and decision_comment", () => {
      const entry = repo.create({
        raw_text: "Which color?",
        type: "task",
        title: "Choose color",
        decision_options: ["Red", "Blue"],
      });
      const updated = repo.update({
        id: entry.id,
        decision_selected: 1,
        decision_comment: "Blue is calming",
      });
      expect(updated?.decision_selected).toBe(1);
      expect(updated?.decision_comment).toBe("Blue is calming");
    });

    it("returns null decision_options when not set", () => {
      const entry = repo.create({ raw_text: "no decision" });
      expect(entry.decision_options).toBeNull();
    });

    it("creates decision entry as a pending task", () => {
      const entry = repo.create({
        raw_text: "Which framework?",
        type: "task",
        title: "Choose framework",
        decision_options: ["React", "Vue", "Svelte"],
        delegatable: false,
      });
      expect(entry.status).toBe("pending");
      expect(entry.decision_options).toEqual(["React", "Vue", "Svelte"]);
      expect(entry.decision_selected).toBeNull();
      expect(entry.delegatable).toBe(false);
    });

    it("selecting a decision and marking done completes the flow", () => {
      const entry = repo.create({
        raw_text: "Which DB?",
        type: "task",
        title: "Choose DB",
        decision_options: ["Postgres", "SQLite"],
      });

      // Simulate human selecting option 0 with a comment, then marking done
      const updated = repo.update({
        id: entry.id,
        decision_selected: 0,
        decision_comment: "Simpler for embedded use",
        status: "done",
      });

      expect(updated?.decision_selected).toBe(0);
      expect(updated?.decision_comment).toBe("Simpler for embedded use");
      expect(updated?.status).toBe("done");
      expect(updated?.completed_at).not.toBeNull();
    });

    it("decision_selected can be cleared back to null", () => {
      const entry = repo.create({
        raw_text: "Pick one",
        type: "task",
        title: "Pick",
        decision_options: ["A", "B"],
      });
      repo.update({ id: entry.id, decision_selected: 1 });
      const cleared = repo.update({ id: entry.id, decision_selected: null });
      expect(cleared?.decision_selected).toBeNull();
    });

    it("rejects out-of-bounds decision_selected", () => {
      const entry = repo.create({
        raw_text: "bounds test",
        type: "task",
        title: "Bounds",
        decision_options: ["A", "B"],
      });
      expect(() => repo.update({ id: entry.id, decision_selected: 2 })).toThrow(/out of bounds/);
      expect(() => repo.update({ id: entry.id, decision_selected: -1 })).toThrow(/out of bounds/);
      expect(() => repo.update({ id: entry.id, decision_selected: 99 })).toThrow(/out of bounds/);
    });

    it("rejects decision_selected when no options exist", () => {
      const entry = repo.create({ raw_text: "no options", type: "task", title: "No opts" });
      expect(() => repo.update({ id: entry.id, decision_selected: 0 })).toThrow(/out of bounds/);
    });

    it("decision entry is found via list filter", () => {
      repo.create({
        raw_text: "Decision 1",
        type: "task",
        title: "D1",
        decision_options: ["X", "Y"],
        delegatable: false,
      });
      repo.create({
        raw_text: "Normal task",
        type: "task",
        title: "T1",
      });

      // Both are tasks, but only one has decision_options
      const allTasks = repo.list({ type: "task" });
      expect(allTasks.length).toBe(2);
      const withDecisions = allTasks.filter(
        (e) => e.decision_options && e.decision_options.length > 0,
      );
      expect(withDecisions.length).toBe(1);
      expect(withDecisions[0].title).toBe("D1");
    });

    it("handles empty decision_options array", () => {
      const entry = repo.create({
        raw_text: "Empty options",
        type: "task",
        title: "Empty",
        decision_options: [],
      });
      // Empty array serializes to "[]" which parses back to empty array
      expect(entry.decision_options).toEqual([]);
    });

    it("preserves decision fields through submitProcessed", () => {
      // Create raw entry with decision options
      const raw = repo.create({
        raw_text: "Which approach?",
        type: "task",
        title: "Approach",
        decision_options: ["Fast", "Thorough"],
      });

      // Re-process should not lose decision fields
      const reprocessed = repo.submitProcessed({
        id: raw.id,
        type: "task",
        title: "Approach (updated)",
        tags: ["architecture"],
        urgent: false,
        due_date: null,
        delegatable: false,
      });

      expect(reprocessed.decision_options).toEqual(["Fast", "Thorough"]);
    });
  });

  // ─── markAllResultsSeen ─────────────────────────────────────

  describe("markAllResultsSeen", () => {
    it("marks all unseen results as seen", () => {
      const e1 = repo.create({ raw_text: "a", type: "task", title: "A" });
      const e2 = repo.create({ raw_text: "b", type: "task", title: "B" });
      repo.update({ id: e1.id, result: "done A" });
      repo.update({ id: e2.id, result: "done B" });

      // Both should be unseen
      expect(repo.getById(e1.id)?.result_seen).toBe(false);
      expect(repo.getById(e2.id)?.result_seen).toBe(false);

      const count = repo.markAllResultsSeen();
      expect(count).toBe(2);

      expect(repo.getById(e1.id)?.result_seen).toBe(true);
      expect(repo.getById(e2.id)?.result_seen).toBe(true);
    });

    it("does not affect entries without results", () => {
      repo.create({ raw_text: "no result", type: "task", title: "NR" });
      const count = repo.markAllResultsSeen();
      expect(count).toBe(0);
    });

    it("does not re-mark already seen results", () => {
      const e = repo.create({ raw_text: "x", type: "task", title: "X" });
      repo.update({ id: e.id, result: "done", result_seen: true });

      const count = repo.markAllResultsSeen();
      expect(count).toBe(0);
    });
  });

  // ─── runInTransaction ─────────────────────────────────────

  describe("runInTransaction", () => {
    it("commits on success", () => {
      repo.runInTransaction(() => {
        repo.create({ raw_text: "in tx" });
      });
      expect(repo.list().length).toBe(1);
    });

    it("rolls back on error", () => {
      expect(() =>
        repo.runInTransaction(() => {
          repo.create({ raw_text: "will rollback" });
          throw new Error("boom");
        }),
      ).toThrow("boom");
      expect(repo.list().length).toBe(0);
    });
  });
});
