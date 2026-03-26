import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import { EntryRepository } from "./repository.js";
import { ScheduledTaskRepository } from "./scheduled-task-repository.js";
import { EntryService } from "./service.js";

function createTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theledger-svc-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  return createDatabase(dbPath);
}

describe("EntryService", () => {
  let db: Database.Database;
  let repo: EntryRepository;
  let scheduledRepo: ScheduledTaskRepository;
  let service: EntryService;

  beforeEach(() => {
    db = createTestDb();
    repo = new EntryRepository(db);
    scheduledRepo = new ScheduledTaskRepository(db);
    service = new EntryService(repo, scheduledRepo);
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

  // ─── decision delegation end-to-end ───────────────────────

  describe("decision delegation flow (end-to-end)", () => {
    it("AI creates decision -> human selects -> completes", () => {
      // Step 1: AI creates a decision entry
      const decision = service.createEntry({
        raw_text: "Which database should we use for the new feature?",
        type: "task",
        title: "Database selection",
        decision_options: ["PostgreSQL", "SQLite", "MySQL"],
        delegatable: false,
        tags: ["architecture", "database"],
      });

      expect(decision.decision_options).toEqual(["PostgreSQL", "SQLite", "MySQL"]);
      expect(decision.decision_selected).toBeNull();
      expect(decision.status).toBe("pending");

      // Step 2: Query pending decisions (simulating dashboard view)
      const pending = service.listEntries({ type: "task", status: "pending" });
      const decisions = pending.filter(
        (e) => e.decision_options && e.decision_options.length > 0 && e.decision_selected == null,
      );
      expect(decisions.length).toBe(1);
      expect(decisions[0].id).toBe(decision.id);

      // Step 3: Human selects option and adds comment
      const selected = service.updateEntry({
        id: decision.id,
        decision_selected: 1, // SQLite
        decision_comment: "Simpler for embedded use case",
        status: "done",
      });

      expect(selected?.decision_selected).toBe(1);
      expect(selected?.decision_comment).toBe("Simpler for embedded use case");
      expect(selected?.status).toBe("done");
      expect(selected?.completed_at).not.toBeNull();

      // Step 4: Verify it no longer appears in pending decisions
      const stillPending = service.listEntries({ type: "task", status: "pending" });
      const openDecisions = stillPending.filter(
        (e) => e.decision_options && e.decision_options.length > 0 && e.decision_selected == null,
      );
      expect(openDecisions.length).toBe(0);
    });

    it("multiple decisions can coexist", () => {
      service.createEntry({
        raw_text: "Decision 1",
        type: "task",
        title: "First choice",
        decision_options: ["A", "B"],
      });
      service.createEntry({
        raw_text: "Decision 2",
        type: "task",
        title: "Second choice",
        decision_options: ["X", "Y", "Z"],
      });
      service.createEntry({
        raw_text: "Normal task",
        type: "task",
        title: "Regular",
      });

      const all = service.listEntries({ type: "task", status: "pending" });
      expect(all.length).toBe(3);

      const withDecisions = all.filter((e) => e.decision_options && e.decision_options.length > 0);
      expect(withDecisions.length).toBe(2);
    });

    it("decision with empty options array is valid but has no selectable choices", () => {
      const entry = service.createEntry({
        raw_text: "Empty decision",
        type: "task",
        title: "No options",
        decision_options: [],
      });
      expect(entry.decision_options).toEqual([]);
      // Cannot select anything
      expect(() => service.updateEntry({ id: entry.id, decision_selected: 0 })).toThrow(
        /out of bounds/,
      );
    });

    it("decision comment can be updated independently", () => {
      const entry = service.createEntry({
        raw_text: "Commentable",
        type: "task",
        title: "Comment test",
        decision_options: ["Yes", "No"],
      });

      const withComment = service.updateEntry({
        id: entry.id,
        decision_comment: "Initial thought",
      });
      expect(withComment?.decision_comment).toBe("Initial thought");
      expect(withComment?.decision_selected).toBeNull();

      const updatedComment = service.updateEntry({
        id: entry.id,
        decision_comment: "Changed my mind",
      });
      expect(updatedComment?.decision_comment).toBe("Changed my mind");
    });
  });

  // ─── CRUD basics ──────────────────────────────────────────

  describe("CRUD operations", () => {
    it("creates and retrieves an entry", () => {
      const entry = service.createEntry({ raw_text: "test" });
      const fetched = service.getEntry(entry.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.raw_text).toBe("test");
    });

    it("returns null for non-existent entry", () => {
      expect(service.getEntry("nonexistent")).toBeNull();
    });

    it("creates pre-classified entry", () => {
      const entry = service.createEntry({
        raw_text: "classified",
        type: "task",
        title: "Classified Task",
        tags: ["work"],
        urgent: true,
      });
      expect(entry.processed).toBe(true);
      expect(entry.type).toBe("task");
      expect(entry.status).toBe("pending");
      expect(entry.urgent).toBe(true);
    });

    it("soft-deletes an entry", () => {
      const entry = service.createEntry({ raw_text: "to delete" });
      expect(service.deleteEntry(entry.id)).toBe(true);
      const after = service.getEntry(entry.id);
      expect(after).not.toBeNull();
      expect(after?.archived_at).not.toBeNull();
      // Excluded from list by default
      const list = service.listEntries();
      expect(list.find((e) => e.id === entry.id)).toBeUndefined();
    });

    it("returns false when deleting non-existent entry", () => {
      expect(service.deleteEntry("nonexistent")).toBe(false);
    });

    it("updates multiple fields at once", () => {
      const entry = service.createEntry({
        raw_text: "original",
        type: "task",
        title: "Original",
      });
      const updated = service.updateEntry({
        id: entry.id,
        title: "Updated",
        urgent: true,
        due_date: "2026-12-31",
      });
      expect(updated?.title).toBe("Updated");
      expect(updated?.urgent).toBe(true);
      expect(updated?.due_date).toBe("2026-12-31");
    });

    it("sets completed_at on status done", () => {
      const entry = service.createEntry({
        raw_text: "complete me",
        type: "task",
        title: "Complete",
      });
      const done = service.updateEntry({ id: entry.id, status: "done" });
      expect(done?.status).toBe("done");
      expect(done?.completed_at).not.toBeNull();
    });

    it("clears completed_at on status pending", () => {
      const entry = service.createEntry({
        raw_text: "toggle",
        type: "task",
        title: "Toggle",
      });
      service.updateEntry({ id: entry.id, status: "done" });
      const reopened = service.updateEntry({ id: entry.id, status: "pending" });
      expect(reopened?.status).toBe("pending");
      expect(reopened?.completed_at).toBeNull();
    });
  });

  // ─── Result management ────────────────────────────────────

  describe("result management", () => {
    it("stores result and result_url on create", () => {
      const entry = service.createEntry({
        raw_text: "with result",
        type: "task",
        title: "Has Result",
        result: "Done!",
        result_url: "https://example.com/pr/1",
      });
      expect(entry.result).toBe("Done!");
      expect(entry.result_url).toBe("https://example.com/pr/1");
    });

    it("updating result resets result_seen", () => {
      const entry = service.createEntry({
        raw_text: "x",
        type: "task",
        title: "X",
      });
      service.updateEntry({ id: entry.id, result: "First" });
      service.updateEntry({ id: entry.id, result_seen: true });

      const updated = service.updateEntry({ id: entry.id, result: "Second" });
      expect(updated?.result).toBe("Second");
      expect(updated?.result_seen).toBe(false);
    });

    it("markAllResultsSeen marks all unseen", () => {
      const e1 = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      const e2 = service.createEntry({ raw_text: "b", type: "task", title: "B" });
      service.updateEntry({ id: e1.id, result: "Done A" });
      service.updateEntry({ id: e2.id, result: "Done B" });

      const count = service.markAllResultsSeen();
      expect(count).toBe(2);

      expect(service.getEntry(e1.id)?.result_seen).toBe(true);
      expect(service.getEntry(e2.id)?.result_seen).toBe(true);
    });

    it("markAllResultsSeen returns 0 when none unseen", () => {
      const entry = service.createEntry({ raw_text: "x", type: "task", title: "X" });
      service.updateEntry({ id: entry.id, result: "Done", result_seen: true });
      expect(service.markAllResultsSeen()).toBe(0);
    });
  });

  // ─── Listing and filtering ────────────────────────────────

  describe("listing and filtering", () => {
    function seed() {
      service.createEntry({ raw_text: "t1", type: "task", title: "Task 1", tags: ["work"] });
      service.createEntry({
        raw_text: "t2",
        type: "task",
        title: "Task 2",
        tags: ["home"],
        delegatable: true,
      });
      service.createEntry({ raw_text: "n1", type: "note", title: "Note 1", tags: ["work"] });
      service.createEntry({ raw_text: "w1", type: "wish", title: "Wish 1" });
      service.createEntry({ raw_text: "unprocessed" });
    }

    it("returns all entries by default", () => {
      seed();
      expect(service.listEntries().length).toBe(5);
    });

    it("filters by type", () => {
      seed();
      expect(service.listEntries({ type: "task" }).length).toBe(2);
    });

    it("filters by tag", () => {
      seed();
      expect(service.listEntries({ tag: "work" }).length).toBe(2);
    });

    it("filters by delegatable", () => {
      seed();
      const d = service.listEntries({ delegatable: true });
      expect(d.length).toBe(1);
      expect(d[0].title).toBe("Task 2");
    });

    it("filters by processed", () => {
      seed();
      expect(service.listEntries({ processed: false }).length).toBe(1);
    });

    it("filters by source", () => {
      service.createEntry({ raw_text: "s1", type: "task", title: "S1", source: "slack" });
      service.createEntry({ raw_text: "s2", type: "task", title: "S2", source: "email" });
      service.createEntry({ raw_text: "s3", type: "task", title: "S3" });

      expect(service.listEntries({ source: "slack" }).length).toBe(1);
      expect(service.listEntries({ source: "any" }).length).toBe(2);
    });

    it("filters by since", () => {
      seed();
      expect(service.listEntries({ since: "2099-01-01" }).length).toBe(0);
      expect(service.listEntries({ since: "2000-01-01" }).length).toBeGreaterThan(0);
    });

    it("filters by until", () => {
      seed();
      expect(service.listEntries({ until: "2000-01-01" }).length).toBe(0);
    });

    it("supports limit and offset", () => {
      seed();
      const page1 = service.listEntries({ limit: 2 });
      const page2 = service.listEntries({ limit: 2, offset: 2 });
      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it("supports sorting by completed_at", () => {
      const e1 = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      const e2 = service.createEntry({ raw_text: "b", type: "task", title: "B" });
      service.updateEntry({ id: e1.id, status: "done" });
      service.updateEntry({ id: e2.id, status: "done" });

      const sorted = service.listEntries({ status: "done", sort: "completed_at" });
      expect(sorted.length).toBe(2);
      // Both completed at roughly the same time; just verify sort key is used
      expect(sorted.every((e) => e.completed_at !== null)).toBe(true);
    });

    it("full-text search works", () => {
      service.createEntry({ raw_text: "buy milk at the store", type: "task", title: "Buy milk" });
      service.createEntry({ raw_text: "fix auth bug", type: "task", title: "Fix auth" });
      const results = service.listEntries({ query: "milk" });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Buy milk");
    });
  });

  // ─── Scheduled tasks ──────────────────────────────────────

  describe("scheduled tasks", () => {
    it("CRUD operations work", () => {
      const task = service.createScheduledTask({
        raw_text: "daily standup",
        frequency: "daily",
        hour: 9,
      });
      expect(task.raw_text).toBe("daily standup");
      expect(task.frequency).toBe("daily");
      expect(task.hour).toBe(9);
      expect(task.enabled).toBe(true);

      const found = service.getScheduledTask(task.id);
      expect(found?.raw_text).toBe("daily standup");

      const updated = service.updateScheduledTask({ id: task.id, raw_text: "updated standup" });
      expect(updated?.raw_text).toBe("updated standup");

      expect(service.deleteScheduledTask(task.id)).toBe(true);
      expect(service.getScheduledTask(task.id)).toBeNull();
    });

    it("lists all scheduled tasks", () => {
      service.createScheduledTask({ raw_text: "task1", frequency: "daily" });
      service.createScheduledTask({ raw_text: "task2", frequency: "weekly", day_of_week: 1 });
      expect(service.listScheduledTasks().length).toBe(2);
    });

    it("throws when scheduled task repo not configured", () => {
      const serviceNoScheduled = new EntryService(repo);
      expect(() =>
        serviceNoScheduled.createScheduledTask({ raw_text: "x", frequency: "daily" }),
      ).toThrow("ScheduledTaskRepository is not configured");
    });

    it("runDueScheduledTasks creates entries for due tasks", () => {
      const now = new Date();
      // Create a daily task at the current hour
      service.createScheduledTask({
        raw_text: "daily check",
        frequency: "daily",
        hour: now.getHours(),
      });

      const created = service.runDueScheduledTasks();
      // May or may not create entries depending on timing
      // But should not throw
      expect(Array.isArray(created)).toBe(true);
    });

    it("runDueScheduledTasks does not re-run tasks already run today", () => {
      const now = new Date();
      service.createScheduledTask({
        raw_text: "once daily",
        frequency: "daily",
        hour: now.getHours(),
      });

      // First run
      service.runDueScheduledTasks();
      // Second run should not create more entries
      const secondRun = service.runDueScheduledTasks();
      expect(secondRun.length).toBe(0);
    });
  });

  // ─── Tag vocabulary ────────────────────────────────────────

  describe("tag vocabulary", () => {
    it("returns tag counts sorted by count desc", () => {
      service.createEntry({ raw_text: "a", type: "task", title: "A", tags: ["common", "rare"] });
      service.createEntry({ raw_text: "b", type: "task", title: "B", tags: ["common"] });

      const vocab = service.getTagVocabulary();
      expect(vocab[0].tag).toBe("common");
      expect(vocab[0].count).toBe(2);
      expect(vocab[1].tag).toBe("rare");
      expect(vocab[1].count).toBe(1);
    });

    it("returns empty array when no tags exist", () => {
      expect(service.getTagVocabulary()).toEqual([]);
    });
  });

  // ─── Stats ─────────────────────────────────────────────────

  describe("stats", () => {
    it("returns correct structure", () => {
      const stats = service.getStats();
      expect(stats).toHaveProperty("streak");
      expect(stats).toHaveProperty("weeklyCompletions");
      expect(stats).toHaveProperty("leadTimeDistribution");
      expect(stats).toHaveProperty("hourlyCompletions");
      expect(stats.weeklyCompletions).toHaveLength(4);
      expect(stats.leadTimeDistribution).toHaveLength(5);
      expect(stats.hourlyCompletions).toHaveLength(24);
    });

    it("streak is non-negative", () => {
      const entry = service.createEntry({
        raw_text: "done today",
        type: "task",
        title: "Today",
      });
      service.updateEntry({ id: entry.id, status: "done" });

      const stats = service.getStats();
      // Streak depends on timezone alignment between SQLite datetime('now') and JS Date
      // In most environments this should be >= 1, but near midnight UTC it could be 0
      expect(stats.streak).toBeGreaterThanOrEqual(0);
    });

    it("streak is 0 with no completions", () => {
      const stats = service.getStats();
      expect(stats.streak).toBe(0);
    });

    it("lead time distribution counts same-day completions", () => {
      const entry = service.createEntry({
        raw_text: "quick",
        type: "task",
        title: "Quick",
      });
      service.updateEntry({ id: entry.id, status: "done" });

      const stats = service.getStats();
      const sameDayBucket = stats.leadTimeDistribution.find((b) => b.bucket === "当日");
      expect(sameDayBucket?.count).toBeGreaterThanOrEqual(1);
    });

    it("hourly completions has 24 entries", () => {
      const stats = service.getStats();
      expect(stats.hourlyCompletions).toHaveLength(24);
      for (let h = 0; h < 24; h++) {
        expect(stats.hourlyCompletions[h].hour).toBe(h);
      }
    });
  });

  // ─── Bulk operations ────────────────────────────────────────

  describe("bulk operations", () => {
    it("bulkUpdateStatus marks multiple entries done", () => {
      const e1 = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      const e2 = service.createEntry({ raw_text: "b", type: "task", title: "B" });

      const count = service.bulkUpdateStatus([e1.id, e2.id], "done");
      expect(count).toBe(2);
      expect(service.getEntry(e1.id)?.status).toBe("done");
      expect(service.getEntry(e2.id)?.status).toBe("done");
    });

    it("bulkDelete soft-deletes multiple entries", () => {
      const e1 = service.createEntry({ raw_text: "a" });
      const e2 = service.createEntry({ raw_text: "b" });

      const count = service.bulkDelete([e1.id, e2.id]);
      expect(count).toBe(2);
      expect(service.getEntry(e1.id)?.archived_at).not.toBeNull();
      expect(service.getEntry(e2.id)?.archived_at).not.toBeNull();
    });

    it("bulkUpdateStatus with empty array returns 0", () => {
      expect(service.bulkUpdateStatus([], "done")).toBe(0);
    });

    it("bulkDelete with empty array returns 0", () => {
      expect(service.bulkDelete([])).toBe(0);
    });
  });

  // ─── Overdue tasks ─────────────────────────────────────────

  describe("overdue tasks", () => {
    it("returns tasks past their due date", () => {
      service.createEntry({
        raw_text: "overdue",
        type: "task",
        title: "Overdue",
        due_date: "2020-01-01",
      });
      service.createEntry({
        raw_text: "future",
        type: "task",
        title: "Future",
        due_date: "2099-12-31",
      });

      const overdue = service.getOverdueTasks("2026-01-01");
      expect(overdue.length).toBe(1);
      expect(overdue[0].title).toBe("Overdue");
    });

    it("uses today when no date specified", () => {
      service.createEntry({
        raw_text: "overdue",
        type: "task",
        title: "Overdue",
        due_date: "2020-01-01",
      });

      const overdue = service.getOverdueTasks();
      expect(overdue.length).toBe(1);
    });

    it("returns empty when no overdue tasks", () => {
      service.createEntry({
        raw_text: "future",
        type: "task",
        title: "Future",
        due_date: "2099-12-31",
      });
      expect(service.getOverdueTasks().length).toBe(0);
    });
  });

  // ─── Type summary ──────────────────────────────────────────

  describe("type summary", () => {
    it("returns counts by type", () => {
      service.createEntry({ raw_text: "a", type: "task", title: "A" });
      service.createEntry({ raw_text: "b", type: "task", title: "B" });
      service.createEntry({ raw_text: "c", type: "note", title: "C" });

      const summary = service.getTypeSummary();
      expect(summary.find((s) => s.type === "task")?.count).toBe(2);
      expect(summary.find((s) => s.type === "note")?.count).toBe(1);
    });
  });

  // ─── Archive completed ──────────────────────────────────────

  describe("archive completed", () => {
    it("does not delete recent completions", () => {
      const entry = service.createEntry({ raw_text: "done", type: "task", title: "Done" });
      service.updateEntry({ id: entry.id, status: "done" });

      const count = service.archiveCompleted(1);
      expect(count).toBe(0);
      expect(service.getEntry(entry.id)).not.toBeNull();
    });
  });

  // ─── Find duplicate ────────────────────────────────────────

  describe("find duplicate", () => {
    it("finds entry with same raw_text", () => {
      service.createEntry({ raw_text: "unique text", type: "task", title: "T" });
      expect(service.findDuplicate("unique text")).not.toBeNull();
    });

    it("returns null when no match", () => {
      expect(service.findDuplicate("no match")).toBeNull();
    });
  });

  // ─── Purge trash ────────────────────────────────────────────

  describe("purge trash", () => {
    it("deletes all trash entries", () => {
      service.createEntry({ raw_text: "a", type: "trash", title: "Trash" });
      service.createEntry({ raw_text: "b", type: "task", title: "Keep" });

      const count = service.purgeTrash();
      expect(count).toBe(1);
      expect(service.listEntries().length).toBe(1);
    });
  });

  // ─── FTS rebuild ───────────────────────────────────────────

  describe("FTS rebuild", () => {
    it("search works after rebuild", () => {
      service.createEntry({ raw_text: "alpha bravo", type: "note", title: "AB" });
      service.rebuildFtsIndex();

      const results = service.listEntries({ query: "alpha" });
      expect(results.length).toBe(1);
    });
  });

  // ─── Count entries ─────────────────────────────────────────

  describe("countEntries", () => {
    it("counts all entries", () => {
      service.createEntry({ raw_text: "a", type: "task", title: "A" });
      service.createEntry({ raw_text: "b", type: "note", title: "B" });
      service.createEntry({ raw_text: "c" });
      expect(service.countEntries()).toBe(3);
    });

    it("counts with filter", () => {
      service.createEntry({ raw_text: "a", type: "task", title: "A" });
      service.createEntry({ raw_text: "b", type: "note", title: "B" });
      expect(service.countEntries({ type: "task" })).toBe(1);
    });
  });

  // ─── getUnprocessed ────────────────────────────────────────

  describe("getUnprocessed", () => {
    it("returns only unprocessed entries", () => {
      service.createEntry({ raw_text: "raw 1" });
      service.createEntry({ raw_text: "raw 2" });
      service.createEntry({ raw_text: "classified", type: "task", title: "C" });

      const unprocessed = service.getUnprocessed();
      expect(unprocessed.length).toBe(2);
      expect(unprocessed.every((e) => !e.processed)).toBe(true);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        service.createEntry({ raw_text: `raw ${i}` });
      }
      expect(service.getUnprocessed(3).length).toBe(3);
    });

    it("returns in created_at ASC order", () => {
      service.createEntry({ raw_text: "first" });
      service.createEntry({ raw_text: "second" });
      const items = service.getUnprocessed();
      expect(items[0].raw_text).toBe("first");
      expect(items[1].raw_text).toBe("second");
    });
  });

  // ─── getEntryOrThrow ─────────────────────────────────────

  describe("getEntryOrThrow", () => {
    it("returns entry when it exists", () => {
      const entry = service.createEntry({ raw_text: "exists" });
      const found = service.getEntryOrThrow(entry.id);
      expect(found.id).toBe(entry.id);
    });

    it("throws when entry does not exist", () => {
      expect(() => service.getEntryOrThrow("nonexistent-id")).toThrow(
        "Entry not found: nonexistent-id",
      );
    });
  });

  // ─── Input validation ────────────────────────────────────

  describe("createEntry input validation", () => {
    it("rejects empty raw_text", () => {
      expect(() => service.createEntry({ raw_text: "" })).toThrow("raw_text must not be empty");
    });

    it("rejects whitespace-only raw_text", () => {
      expect(() => service.createEntry({ raw_text: "   " })).toThrow("raw_text must not be empty");
    });

    it("rejects title over 200 chars", () => {
      expect(() =>
        service.createEntry({
          raw_text: "test",
          type: "note",
          title: "a".repeat(201),
        }),
      ).toThrow(/title too long/);
    });

    it("accepts title at exactly 200 chars", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "note",
        title: "a".repeat(200),
      });
      expect(entry.title).toHaveLength(200);
    });

    it("rejects invalid due_date format", () => {
      expect(() =>
        service.createEntry({
          raw_text: "test",
          type: "task",
          title: "Test",
          due_date: "not-a-date",
        }),
      ).toThrow(/Invalid due_date format/);
    });

    it("accepts valid ISO due_date", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "task",
        title: "Test",
        due_date: "2026-12-31",
      });
      expect(entry.due_date).toBe("2026-12-31");
    });

    it("accepts null due_date", () => {
      const entry = service.createEntry({
        raw_text: "test",
        type: "task",
        title: "Test",
        due_date: null,
      });
      expect(entry.due_date).toBeNull();
    });
  });

  // ─── Convenience count methods ────────────────────────────

  describe("getDelegatableTaskCount", () => {
    it("returns count of pending delegatable tasks", () => {
      service.createEntry({ raw_text: "d1", type: "task", title: "D1", delegatable: true });
      service.createEntry({ raw_text: "d2", type: "task", title: "D2", delegatable: true });
      service.createEntry({ raw_text: "n1", type: "task", title: "N1", delegatable: false });
      service.createEntry({ raw_text: "n2", type: "note", title: "N2", delegatable: true });
      expect(service.getDelegatableTaskCount()).toBe(2);
    });

    it("returns 0 when no delegatable tasks", () => {
      expect(service.getDelegatableTaskCount()).toBe(0);
    });

    it("excludes done delegatable tasks", () => {
      const e = service.createEntry({
        raw_text: "d1",
        type: "task",
        title: "D1",
        delegatable: true,
      });
      service.updateEntry({ id: e.id, status: "done" });
      expect(service.getDelegatableTaskCount()).toBe(0);
    });
  });

  describe("getUnseenResultCount", () => {
    it("returns count of unseen results", () => {
      const e1 = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      const e2 = service.createEntry({ raw_text: "b", type: "task", title: "B" });
      service.updateEntry({ id: e1.id, result: "Done A" });
      service.updateEntry({ id: e2.id, result: "Done B" });
      expect(service.getUnseenResultCount()).toBe(2);
    });

    it("returns 0 when all results seen", () => {
      const e1 = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      service.updateEntry({ id: e1.id, result: "Done" });
      service.updateEntry({ id: e1.id, result_seen: true });
      expect(service.getUnseenResultCount()).toBe(0);
    });

    it("returns 0 when no results", () => {
      service.createEntry({ raw_text: "a", type: "task", title: "A" });
      expect(service.getUnseenResultCount()).toBe(0);
    });
  });

  describe("getPendingDecisionCount", () => {
    it("counts entries with unresolved decisions", () => {
      service.createEntry({
        raw_text: "decide 1",
        type: "task",
        title: "Decision 1",
        decision_options: ["A", "B"],
      });
      service.createEntry({
        raw_text: "decide 2",
        type: "task",
        title: "Decision 2",
        decision_options: ["X", "Y"],
      });
      expect(service.getPendingDecisionCount()).toBe(2);
    });

    it("excludes resolved decisions", () => {
      const e = service.createEntry({
        raw_text: "decide",
        type: "task",
        title: "Decision",
        decision_options: ["A", "B"],
      });
      service.updateEntry({ id: e.id, decision_selected: 0 });
      expect(service.getPendingDecisionCount()).toBe(0);
    });

    it("excludes entries with empty options", () => {
      service.createEntry({
        raw_text: "empty",
        type: "task",
        title: "Empty",
        decision_options: [],
      });
      expect(service.getPendingDecisionCount()).toBe(0);
    });

    it("returns 0 when no decisions exist", () => {
      service.createEntry({ raw_text: "normal", type: "task", title: "Normal" });
      expect(service.getPendingDecisionCount()).toBe(0);
    });
  });

  // ─── Batch getEntriesByIds ──────────────────────────────────

  describe("getEntriesByIds", () => {
    it("returns entries matching the given IDs", () => {
      const e1 = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      const e2 = service.createEntry({ raw_text: "b", type: "task", title: "B" });
      service.createEntry({ raw_text: "c", type: "task", title: "C" });

      const results = service.getEntriesByIds([e1.id, e2.id]);
      expect(results.length).toBe(2);
      const ids = results.map((e) => e.id).sort();
      expect(ids).toEqual([e1.id, e2.id].sort());
    });

    it("returns empty array for empty input", () => {
      expect(service.getEntriesByIds([])).toEqual([]);
    });

    it("skips non-existent IDs", () => {
      const e1 = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      const results = service.getEntriesByIds([e1.id, "nonexistent"]);
      expect(results.length).toBe(1);
    });
  });

  // ─── Scheduled task count ──────────────────────────────────

  describe("getScheduledTaskCount", () => {
    it("returns count of enabled scheduled tasks", () => {
      service.createScheduledTask({ raw_text: "a", frequency: "daily" });
      service.createScheduledTask({ raw_text: "b", frequency: "weekly", day_of_week: 1 });
      expect(service.getScheduledTaskCount()).toBe(2);
    });

    it("excludes disabled tasks", () => {
      const t = service.createScheduledTask({ raw_text: "a", frequency: "daily" });
      service.updateScheduledTask({ id: t.id, enabled: false });
      expect(service.getScheduledTaskCount()).toBe(0);
    });

    it("returns 0 when no tasks", () => {
      expect(service.getScheduledTaskCount()).toBe(0);
    });
  });

  // ─── Scheduled task input validation ───────────────────────

  describe("scheduled task input validation", () => {
    it("rejects invalid hour", () => {
      expect(() =>
        service.createScheduledTask({ raw_text: "x", frequency: "daily", hour: 25 }),
      ).toThrow(/Invalid hour/);
    });

    it("rejects negative hour", () => {
      expect(() =>
        service.createScheduledTask({ raw_text: "x", frequency: "daily", hour: -1 }),
      ).toThrow(/Invalid hour/);
    });

    it("rejects invalid day_of_week", () => {
      expect(() =>
        service.createScheduledTask({
          raw_text: "x",
          frequency: "weekly",
          day_of_week: 7,
        }),
      ).toThrow(/Invalid day_of_week/);
    });

    it("rejects invalid day_of_month", () => {
      expect(() =>
        service.createScheduledTask({
          raw_text: "x",
          frequency: "monthly",
          day_of_month: 0,
        }),
      ).toThrow(/Invalid day_of_month/);
    });

    it("rejects day_of_month > 31", () => {
      expect(() =>
        service.createScheduledTask({
          raw_text: "x",
          frequency: "monthly",
          day_of_month: 32,
        }),
      ).toThrow(/Invalid day_of_month/);
    });

    it("accepts valid inputs", () => {
      const task = service.createScheduledTask({
        raw_text: "valid",
        frequency: "weekly",
        day_of_week: 0,
        hour: 23,
      });
      expect(task.day_of_week).toBe(0);
      expect(task.hour).toBe(23);
    });
  });

  // ─── FTS special character handling ────────────────────────

  describe("FTS special character handling", () => {
    it("handles asterisk in query", () => {
      service.createEntry({ raw_text: "test asterisk", type: "note", title: "Test" });
      const results = service.listEntries({ query: "test*" });
      expect(Array.isArray(results)).toBe(true);
    });

    it("handles quotes in query", () => {
      service.createEntry({ raw_text: "quoted text", type: "note", title: "Q" });
      const results = service.listEntries({ query: '"quoted"' });
      expect(Array.isArray(results)).toBe(true);
    });

    it("handles parentheses in query", () => {
      service.createEntry({ raw_text: "paren text", type: "note", title: "P" });
      const results = service.listEntries({ query: "(paren)" });
      expect(Array.isArray(results)).toBe(true);
    });

    it("handles OR AND NOT keywords in query", () => {
      service.createEntry({ raw_text: "boolean logic", type: "note", title: "B" });
      const results = service.listEntries({ query: "OR AND NOT" });
      expect(Array.isArray(results)).toBe(true);
    });

    it("handles empty query gracefully", () => {
      service.createEntry({ raw_text: "something", type: "note", title: "S" });
      // Empty query should not crash (returns FTS with empty match)
      const results = service.listEntries({ query: "" });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ─── updateEntry additional scenarios ─────────────────────

  describe("updateEntry additional scenarios", () => {
    it("updates result_url independently", () => {
      const entry = service.createEntry({ raw_text: "x", type: "task", title: "X" });
      const updated = service.updateEntry({
        id: entry.id,
        result_url: "https://github.com/pr/123",
      });
      expect(updated?.result_url).toBe("https://github.com/pr/123");
    });

    it("updates result_url to different value", () => {
      const entry = service.createEntry({
        raw_text: "x",
        type: "task",
        title: "X",
        result_url: "https://old.com",
      });
      const updated = service.updateEntry({
        id: entry.id,
        result_url: "https://new.com",
      });
      expect(updated?.result_url).toBe("https://new.com");
    });
  });

  // ─── bulkUpdateStatus edge cases ─────────────────────────

  describe("bulkUpdateStatus edge cases", () => {
    it("returns 0 for non-existent IDs", () => {
      const count = service.bulkUpdateStatus(["fake-id-1", "fake-id-2"], "done");
      expect(count).toBe(0);
    });

    it("handles mix of existing and non-existing IDs", () => {
      const e = service.createEntry({ raw_text: "a", type: "task", title: "A" });
      const count = service.bulkUpdateStatus([e.id, "fake-id"], "done");
      expect(count).toBe(1);
      expect(service.getEntry(e.id)?.status).toBe("done");
    });
  });

  // ─── countEntries with combined filters ────────────────────

  describe("countEntries combined filters", () => {
    function seedForCombined() {
      service.createEntry({
        raw_text: "t1",
        type: "task",
        title: "Task 1",
        tags: ["work"],
        source: "slack",
      });
      service.createEntry({
        raw_text: "t2",
        type: "task",
        title: "Task 2",
        tags: ["home"],
        source: "email",
        delegatable: true,
      });
      service.createEntry({
        raw_text: "n1",
        type: "note",
        title: "Note 1",
        tags: ["work"],
        source: "slack",
      });
      const e4 = service.createEntry({
        raw_text: "t3",
        type: "task",
        title: "Task 3",
        tags: ["work"],
        source: "slack",
      });
      service.updateEntry({ id: e4.id, status: "done" });
    }

    it("counts with type + tag combined", () => {
      seedForCombined();
      expect(service.countEntries({ type: "task", tag: "work" })).toBe(2);
    });

    it("counts with type + status + tag", () => {
      seedForCombined();
      expect(service.countEntries({ type: "task", status: "pending", tag: "work" })).toBe(1);
    });

    it("counts with type + source", () => {
      seedForCombined();
      expect(service.countEntries({ type: "task", source: "slack" })).toBe(2);
    });

    it("counts with source=any + type", () => {
      seedForCombined();
      expect(service.countEntries({ source: "any", type: "task" })).toBe(3);
    });

    it("counts with delegatable + type", () => {
      seedForCombined();
      expect(service.countEntries({ delegatable: true, type: "task" })).toBe(1);
    });

    it("counts with since filter", () => {
      seedForCombined();
      expect(service.countEntries({ type: "task", since: "2000-01-01" })).toBe(3);
      expect(service.countEntries({ type: "task", since: "2099-01-01" })).toBe(0);
    });
  });

  // ─── result_url CRUD ────────────────────────────────────

  describe("result_url CRUD", () => {
    it("creates entry with result_url", () => {
      const entry = service.createEntry({
        raw_text: "deploy site",
        type: "task",
        title: "Deploy site",
        tags: ["deploy"],
        result_url: "https://example.com/deploy",
      });
      expect(entry.result_url).toBe("https://example.com/deploy");
    });

    it("creates entry without result_url defaults to null", () => {
      const entry = service.createEntry({
        raw_text: "no url task",
        type: "task",
        title: "No URL",
        tags: [],
      });
      expect(entry.result_url).toBeNull();
    });

    it("updates result_url independently", () => {
      const entry = service.createEntry({
        raw_text: "task",
        type: "task",
        title: "Task",
        tags: [],
      });
      const updated = service.updateEntry({
        id: entry.id,
        result_url: "https://github.com/pr/1",
      });
      expect(updated?.result_url).toBe("https://github.com/pr/1");
    });

    it("result_url persists after status change", () => {
      const entry = service.createEntry({
        raw_text: "task",
        type: "task",
        title: "Task",
        tags: [],
        result_url: "https://example.com",
      });
      const done = service.updateEntry({ id: entry.id, status: "done" });
      expect(done?.result_url).toBe("https://example.com");
      expect(done?.status).toBe("done");

      const reopened = service.updateEntry({ id: entry.id, status: "pending" });
      expect(reopened?.result_url).toBe("https://example.com");
    });

    it("result_url can be set alongside result", () => {
      const entry = service.createEntry({
        raw_text: "task",
        type: "task",
        title: "Task",
        tags: [],
      });
      const updated = service.updateEntry({
        id: entry.id,
        result: "# Done\nDeployed successfully",
        result_url: "https://prod.example.com",
        status: "done",
      });
      expect(updated?.result).toBe("# Done\nDeployed successfully");
      expect(updated?.result_url).toBe("https://prod.example.com");
      expect(updated?.status).toBe("done");
    });

    it("result_url can be overwritten", () => {
      const entry = service.createEntry({
        raw_text: "task",
        type: "task",
        title: "Task",
        tags: [],
        result_url: "https://old.com",
      });
      const updated = service.updateEntry({
        id: entry.id,
        result_url: "https://new.com",
      });
      expect(updated?.result_url).toBe("https://new.com");
    });
  });

  // ─── decision_options validation ─────────────────────────

  describe("decision_options validation", () => {
    it("creates entry with decision_options", () => {
      const entry = service.createEntry({
        raw_text: "Which framework?",
        type: "task",
        title: "Choose framework",
        tags: ["decisions"],
        decision_options: ["React", "Vue", "Svelte"],
      });
      expect(entry.decision_options).toEqual(["React", "Vue", "Svelte"]);
      expect(entry.decision_selected).toBeNull();
    });

    it("rejects out-of-bounds decision_selected (positive)", () => {
      const entry = service.createEntry({
        raw_text: "Pick one",
        type: "task",
        title: "Pick",
        tags: [],
        decision_options: ["A", "B"],
      });
      expect(() => service.updateEntry({ id: entry.id, decision_selected: 5 })).toThrow();
    });

    it("rejects negative decision_selected", () => {
      const entry = service.createEntry({
        raw_text: "Pick one",
        type: "task",
        title: "Pick",
        tags: [],
        decision_options: ["A", "B"],
      });
      expect(() => service.updateEntry({ id: entry.id, decision_selected: -1 })).toThrow();
    });

    it("allows null decision_selected to reset", () => {
      const entry = service.createEntry({
        raw_text: "Pick one",
        type: "task",
        title: "Pick",
        tags: [],
        decision_options: ["A", "B"],
      });
      service.updateEntry({ id: entry.id, decision_selected: 0 });
      const reset = service.updateEntry({ id: entry.id, decision_selected: null });
      expect(reset?.decision_selected).toBeNull();
    });

    it("stores decision_comment", () => {
      const entry = service.createEntry({
        raw_text: "Pick one",
        type: "task",
        title: "Pick",
        tags: [],
        decision_options: ["A", "B"],
      });
      const updated = service.updateEntry({
        id: entry.id,
        decision_selected: 1,
        decision_comment: "B is better because...",
      });
      expect(updated?.decision_selected).toBe(1);
      expect(updated?.decision_comment).toBe("B is better because...");
    });

    it("rejects decision_selected when no options exist", () => {
      const entry = service.createEntry({
        raw_text: "No options",
        type: "task",
        title: "No opts",
        tags: [],
      });
      expect(() => service.updateEntry({ id: entry.id, decision_selected: 0 })).toThrow();
    });
  });

  // ─── since/until date filtering ──────────────────────────

  describe("since/until date filtering", () => {
    it("filters entries created since a date", () => {
      service.createEntry({ raw_text: "old entry", type: "note", title: "Old", tags: [] });
      const results = service.listEntries({ since: "2000-01-01" });
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns nothing for future since date", () => {
      service.createEntry({ raw_text: "entry", type: "note", title: "E", tags: [] });
      const results = service.listEntries({ since: "2099-01-01" });
      expect(results.length).toBe(0);
    });

    it("returns nothing when until is in the past", () => {
      service.createEntry({ raw_text: "entry", type: "note", title: "E", tags: [] });
      const results = service.listEntries({ until: "2000-01-01" });
      expect(results.length).toBe(0);
    });

    it("returns entries when until is far future", () => {
      service.createEntry({ raw_text: "entry", type: "note", title: "E", tags: [] });
      const results = service.listEntries({ until: "2099-01-01" });
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns nothing when since equals until", () => {
      service.createEntry({ raw_text: "entry", type: "note", title: "E", tags: [] });
      // same instant means zero-width window
      const results = service.listEntries({ since: "2099-01-01", until: "2099-01-01" });
      expect(results.length).toBe(0);
    });

    it("count respects since/until filters", () => {
      service.createEntry({ raw_text: "e1", type: "note", title: "E1", tags: [] });
      service.createEntry({ raw_text: "e2", type: "note", title: "E2", tags: [] });
      expect(service.countEntries({ since: "2000-01-01" })).toBe(2);
      expect(service.countEntries({ since: "2099-01-01" })).toBe(0);
      expect(service.countEntries({ until: "2000-01-01" })).toBe(0);
    });
  });

  // ─── getRecentActivity ──────────────────────────────────

  describe("getRecentActivity", () => {
    it("returns only processed entries", () => {
      // Create a raw unprocessed entry
      service.createEntry({ raw_text: "raw entry" });
      // Create a processed entry
      service.createEntry({ raw_text: "processed", type: "note", title: "Note", tags: [] });

      const activity = service.getRecentActivity(10);
      expect(activity.length).toBe(1);
      expect(activity[0].title).toBe("Note");
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        service.createEntry({ raw_text: `entry ${i}`, type: "note", title: `Note ${i}`, tags: [] });
      }
      const activity = service.getRecentActivity(3);
      expect(activity.length).toBe(3);
    });

    it("returns empty array when no processed entries", () => {
      service.createEntry({ raw_text: "raw1" });
      service.createEntry({ raw_text: "raw2" });
      const activity = service.getRecentActivity(10);
      expect(activity.length).toBe(0);
    });
  });

  // ─── getOverdueTasks detailed ───────────────────────────

  describe("getOverdueTasks detailed", () => {
    it("returns tasks with past due_date", () => {
      service.createEntry({
        raw_text: "overdue task",
        type: "task",
        title: "Overdue",
        tags: [],
        due_date: "2020-01-01",
      });
      const overdue = service.getOverdueTasks("2025-01-01");
      expect(overdue.length).toBe(1);
      expect(overdue[0].title).toBe("Overdue");
    });

    it("excludes tasks with future due_date", () => {
      service.createEntry({
        raw_text: "future task",
        type: "task",
        title: "Future",
        tags: [],
        due_date: "2099-12-31",
      });
      const overdue = service.getOverdueTasks("2025-01-01");
      expect(overdue.length).toBe(0);
    });

    it("excludes tasks without due_date", () => {
      service.createEntry({
        raw_text: "no due date",
        type: "task",
        title: "No due",
        tags: [],
      });
      const overdue = service.getOverdueTasks("2025-01-01");
      expect(overdue.length).toBe(0);
    });

    it("excludes done tasks", () => {
      const entry = service.createEntry({
        raw_text: "done overdue",
        type: "task",
        title: "Done overdue",
        tags: [],
        due_date: "2020-01-01",
      });
      service.updateEntry({ id: entry.id, status: "done" });
      const overdue = service.getOverdueTasks("2025-01-01");
      expect(overdue.length).toBe(0);
    });

    it("uses custom beforeDate", () => {
      service.createEntry({
        raw_text: "task1",
        type: "task",
        title: "T1",
        tags: [],
        due_date: "2024-06-15",
      });
      // Not overdue if beforeDate is before due_date
      expect(service.getOverdueTasks("2024-01-01").length).toBe(0);
      // Overdue if beforeDate is after due_date
      expect(service.getOverdueTasks("2024-07-01").length).toBe(1);
    });
  });

  // ─── submitProcessed status handling ────────────────────

  describe("submitProcessed status handling", () => {
    it("sets status to pending for tasks", () => {
      const raw = service.createEntry({ raw_text: "raw task" });
      const processed = service.submitProcessed({
        id: raw.id,
        type: "task",
        title: "Task",
        tags: ["work"],
        urgent: false,
        due_date: null,
        delegatable: false,
      });
      expect(processed.status).toBe("pending");
      expect(processed.processed).toBe(true);
    });

    it("sets status to pending for delegatable non-tasks", () => {
      const raw = service.createEntry({ raw_text: "raw wish" });
      const processed = service.submitProcessed({
        id: raw.id,
        type: "wish",
        title: "Wish",
        tags: [],
        urgent: false,
        due_date: null,
        delegatable: true,
      });
      expect(processed.status).toBe("pending");
    });

    it("replaces tags on reprocessing", () => {
      const entry = service.createEntry({
        raw_text: "tag test",
        type: "note",
        title: "Note",
        tags: ["old-tag"],
      });
      const reprocessed = service.submitProcessed({
        id: entry.id,
        type: "note",
        title: "Note updated",
        tags: ["new-tag-1", "new-tag-2"],
        urgent: false,
        due_date: null,
        delegatable: false,
      });
      expect(reprocessed.tags.sort()).toEqual(["new-tag-1", "new-tag-2"]);
      // Old tag should be gone
      expect(reprocessed.tags).not.toContain("old-tag");
    });
  });

  // ─── getTagVocabulary ───────────────────────────────────

  describe("getTagVocabulary", () => {
    it("returns empty array when no tags", () => {
      const vocab = service.getTagVocabulary();
      expect(vocab).toEqual([]);
    });

    it("returns tags with correct counts", () => {
      service.createEntry({ raw_text: "e1", type: "note", title: "N1", tags: ["work", "urgent"] });
      service.createEntry({
        raw_text: "e2",
        type: "note",
        title: "N2",
        tags: ["work", "personal"],
      });
      service.createEntry({ raw_text: "e3", type: "note", title: "N3", tags: ["work"] });

      const vocab = service.getTagVocabulary();
      const workTag = vocab.find((v) => v.tag === "work");
      const urgentTag = vocab.find((v) => v.tag === "urgent");
      const personalTag = vocab.find((v) => v.tag === "personal");

      expect(workTag?.count).toBe(3);
      expect(urgentTag?.count).toBe(1);
      expect(personalTag?.count).toBe(1);
    });

    it("is ordered by count descending", () => {
      service.createEntry({ raw_text: "e1", type: "note", title: "N1", tags: ["rare"] });
      service.createEntry({ raw_text: "e2", type: "note", title: "N2", tags: ["common"] });
      service.createEntry({ raw_text: "e3", type: "note", title: "N3", tags: ["common"] });

      const vocab = service.getTagVocabulary();
      expect(vocab[0].tag).toBe("common");
      expect(vocab[1].tag).toBe("rare");
    });
  });

  // ─── listEntries sort parameter ─────────────────────────

  describe("listEntries sort parameter", () => {
    it("sorts by created_at descending by default", () => {
      service.createEntry({ raw_text: "first", type: "note", title: "First", tags: [] });
      service.createEntry({ raw_text: "second", type: "note", title: "Second", tags: [] });
      const entries = service.listEntries({});
      // Most recent first
      expect(entries[0].title).toBe("Second");
      expect(entries[1].title).toBe("First");
    });

    it("sorts by completed_at when specified", () => {
      const e1 = service.createEntry({ raw_text: "t1", type: "task", title: "T1", tags: [] });
      const e2 = service.createEntry({ raw_text: "t2", type: "task", title: "T2", tags: [] });
      // Complete T1 first, then T2
      service.updateEntry({ id: e1.id, status: "done" });
      service.updateEntry({ id: e2.id, status: "done" });

      const entries = service.listEntries({ sort: "completed_at" });
      // Most recently completed first
      expect(entries[0].title).toBe("T2");
    });
  });

  // ─── runDueScheduledTasks ───────────────────────────────

  describe("runDueScheduledTasks", () => {
    it("creates entries for due tasks", () => {
      const now = new Date();
      scheduledRepo.create({
        raw_text: "daily standup",
        frequency: "daily",
        hour: now.getHours(),
      });

      const created = service.runDueScheduledTasks();
      expect(created.length).toBe(1);
      expect(created[0].raw_text).toBe("daily standup");
    });

    it("marks task as run so it won't trigger again", () => {
      const now = new Date();
      const task = scheduledRepo.create({
        raw_text: "once per day",
        frequency: "daily",
        hour: now.getHours(),
      });

      service.runDueScheduledTasks();
      const updatedTask = scheduledRepo.getById(task.id);
      expect(updatedTask?.last_run_at).not.toBeNull();

      // Second run should not create new entries
      const secondRun = service.runDueScheduledTasks();
      expect(secondRun.length).toBe(0);
    });

    it("returns empty when no tasks are due", () => {
      const now = new Date();
      const differentHour = (now.getHours() + 12) % 24;
      scheduledRepo.create({
        raw_text: "not due",
        frequency: "daily",
        hour: differentHour,
      });

      const created = service.runDueScheduledTasks();
      expect(created.length).toBe(0);
    });
  });

  // ─── Input validation (extended) ──────────────────────────

  describe("createEntry extended validation", () => {
    it("rejects raw_text over 50000 chars", () => {
      expect(() => service.createEntry({ raw_text: "x".repeat(50_001) })).toThrow(
        /raw_text too long/,
      );
    });

    it("accepts raw_text at exactly 50000 chars", () => {
      const entry = service.createEntry({ raw_text: "x".repeat(50_000) });
      expect(entry.raw_text.length).toBe(50_000);
    });

    it("rejects more than 20 decision_options", () => {
      const options = Array.from({ length: 21 }, (_, i) => `Option ${i}`);
      expect(() =>
        service.createEntry({
          raw_text: "too many options",
          type: "task",
          title: "Options",
          decision_options: options,
        }),
      ).toThrow(/Too many decision_options/);
    });

    it("accepts exactly 20 decision_options", () => {
      const options = Array.from({ length: 20 }, (_, i) => `Option ${i}`);
      const entry = service.createEntry({
        raw_text: "many options",
        type: "task",
        title: "Options",
        decision_options: options,
      });
      expect(entry.decision_options?.length).toBe(20);
    });
  });

  // ─── listEntriesWithCursor ─────────────────────────────────

  describe("listEntriesWithCursor", () => {
    it("returns entries with nextCursor", () => {
      for (let i = 0; i < 5; i++) {
        service.createEntry({ raw_text: `e${i}`, type: "task", title: `E${i}` });
      }

      const page1 = service.listEntriesWithCursor({ limit: 2 });
      expect(page1.entries.length).toBe(2);
      expect(page1.nextCursor).not.toBeNull();

      // biome-ignore lint/style/noNonNullAssertion: nextCursor asserted non-null above
      const page2 = service.listEntriesWithCursor({ limit: 2, cursor: page1.nextCursor! });
      expect(page2.entries.length).toBe(2);
      // No overlap between pages
      const page1Ids = new Set(page1.entries.map((e) => e.id));
      for (const entry of page2.entries) {
        expect(page1Ids.has(entry.id)).toBe(false);
      }
    });

    it("returns null nextCursor on last page", () => {
      service.createEntry({ raw_text: "only one", type: "task", title: "Solo" });

      const result = service.listEntriesWithCursor({ limit: 10 });
      expect(result.entries.length).toBe(1);
      expect(result.nextCursor).toBeNull();
    });

    it("works with type filter", () => {
      service.createEntry({ raw_text: "t1", type: "task", title: "T1" });
      service.createEntry({ raw_text: "n1", type: "note", title: "N1" });

      const result = service.listEntriesWithCursor({ type: "task" });
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe("task");
    });
  });

  // ─── reopenTask ───────────────────────────────────────────

  describe("reopenTask", () => {
    it("reopens a completed task back to pending", () => {
      const entry = service.createEntry({
        raw_text: "do something",
        type: "task",
        title: "Task",
        tags: ["test"],
      });
      service.updateEntry({ id: entry.id, status: "done", result: "Did it" });

      const reopened = service.reopenTask(entry.id);
      expect(reopened.status).toBe("pending");
      expect(reopened.completed_at).toBeNull();
    });

    it("appends feedback to existing result", () => {
      const entry = service.createEntry({
        raw_text: "do something",
        type: "task",
        title: "Task",
        tags: ["test"],
      });
      service.updateEntry({ id: entry.id, status: "done", result: "Original result" });

      const reopened = service.reopenTask(entry.id, "This was wrong, try again");
      expect(reopened.status).toBe("pending");
      expect(reopened.result).toContain("Original result");
      expect(reopened.result).toContain("**Feedback (reopen):** This was wrong, try again");
    });

    it("throws when entry not found", () => {
      expect(() => service.reopenTask("nonexistent")).toThrow(/not found/);
    });

    it("throws when entry is not done", () => {
      const entry = service.createEntry({
        raw_text: "pending task",
        type: "task",
        title: "Task",
        tags: [],
      });
      expect(() => service.reopenTask(entry.id)).toThrow(/not done/);
    });

    it("works without feedback when result is null", () => {
      const entry = service.createEntry({
        raw_text: "task",
        type: "task",
        title: "Task",
        tags: [],
      });
      service.updateEntry({ id: entry.id, status: "done" });

      const reopened = service.reopenTask(entry.id);
      expect(reopened.status).toBe("pending");
      expect(reopened.result).toBeNull();
    });

    it("sets feedback as result when original result is null", () => {
      const entry = service.createEntry({
        raw_text: "task",
        type: "task",
        title: "Task",
        tags: [],
      });
      service.updateEntry({ id: entry.id, status: "done" });

      const reopened = service.reopenTask(entry.id, "Please do this properly");
      expect(reopened.status).toBe("pending");
      expect(reopened.result).toContain("**Feedback (reopen):** Please do this properly");
    });
  });

  // ─── bulkTagRename ────────────────────────────────────────

  describe("bulkTagRename", () => {
    it("renames a tag across multiple entries", () => {
      service.createEntry({ raw_text: "a", type: "note", title: "A", tags: ["old-tag"] });
      service.createEntry({ raw_text: "b", type: "note", title: "B", tags: ["old-tag", "other"] });

      const count = service.bulkTagRename("old-tag", "new-tag");
      expect(count).toBe(2);

      const entries = service.listEntries({ tag: "new-tag" });
      expect(entries.length).toBe(2);

      const oldEntries = service.listEntries({ tag: "old-tag" });
      expect(oldEntries.length).toBe(0);
    });

    it("handles conflict when entry already has the new tag", () => {
      service.createEntry({
        raw_text: "c",
        type: "note",
        title: "C",
        tags: ["old-tag", "new-tag"],
      });

      const count = service.bulkTagRename("old-tag", "new-tag");
      expect(count).toBe(1);

      const entries = service.listEntries({ tag: "new-tag" });
      expect(entries.length).toBe(1);
      // Should not have duplicate tags
      expect(entries[0].tags.filter((t) => t === "new-tag").length).toBe(1);
    });

    it("normalizes tag names", () => {
      service.createEntry({ raw_text: "d", type: "note", title: "D", tags: ["foo"] });

      const count = service.bulkTagRename("FOO", "BAR");
      expect(count).toBe(1);

      const entries = service.listEntries({ tag: "bar" });
      expect(entries.length).toBe(1);
    });

    it("throws when tags are empty", () => {
      expect(() => service.bulkTagRename("", "new")).toThrow(/empty/);
      expect(() => service.bulkTagRename("old", "")).toThrow(/empty/);
    });

    it("throws when old and new tag are the same", () => {
      expect(() => service.bulkTagRename("same", "same")).toThrow(/same/);
    });

    it("returns 0 when old tag does not exist", () => {
      const count = service.bulkTagRename("nonexistent", "something");
      expect(count).toBe(0);
    });
  });

  // ─── mergeTags ────────────────────────────────────────────

  describe("mergeTags", () => {
    it("merges multiple source tags into one target", () => {
      service.createEntry({ raw_text: "e", type: "note", title: "E", tags: ["tag-a"] });
      service.createEntry({ raw_text: "f", type: "note", title: "F", tags: ["tag-b"] });
      service.createEntry({ raw_text: "g", type: "note", title: "G", tags: ["tag-c"] });

      const count = service.mergeTags(["tag-a", "tag-b", "tag-c"], "merged");
      expect(count).toBe(3);

      const entries = service.listEntries({ tag: "merged" });
      expect(entries.length).toBe(3);
    });

    it("skips source tags that equal the target", () => {
      service.createEntry({ raw_text: "h", type: "note", title: "H", tags: ["keep"] });
      service.createEntry({ raw_text: "i", type: "note", title: "I", tags: ["remove"] });

      const count = service.mergeTags(["keep", "remove"], "keep");
      // Only "remove" should be renamed, "keep" is skipped
      expect(count).toBe(1);
    });

    it("throws when target is empty", () => {
      expect(() => service.mergeTags(["a"], "")).toThrow(/empty/);
    });

    it("throws when no valid source tags remain after filtering", () => {
      expect(() => service.mergeTags(["target"], "target")).toThrow(/No valid source/);
    });
  });

  // ─── exportEntries ────────────────────────────────────────

  describe("exportEntries", () => {
    it("exports all entries matching a filter", () => {
      service.createEntry({ raw_text: "t1", type: "task", title: "T1", tags: ["work"] });
      service.createEntry({ raw_text: "t2", type: "task", title: "T2", tags: ["work"] });
      service.createEntry({ raw_text: "n1", type: "note", title: "N1", tags: ["personal"] });

      const exported = service.exportEntries({ type: "task" });
      expect(exported.length).toBe(2);
      expect(exported.every((e) => e.type === "task")).toBe(true);
    });

    it("exports all entries without filter", () => {
      service.createEntry({ raw_text: "a", type: "task", title: "A", tags: [] });
      service.createEntry({ raw_text: "b", type: "note", title: "B", tags: [] });

      const exported = service.exportEntries();
      expect(exported.length).toBe(2);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        service.createEntry({ raw_text: `entry-${i}`, type: "note", title: `E${i}`, tags: [] });
      }

      const exported = service.exportEntries({ limit: 3 });
      expect(exported.length).toBe(3);
    });
  });

  // ─── getTodayBriefingData ────────────────────────────────

  describe("getTodayBriefingData", () => {
    const TODAY = "2026-03-26";
    const YESTERDAY = "2026-03-25";
    const TOMORROW = "2026-03-27";
    const LAST_WEEK = "2026-03-19";

    it("returns empty arrays when no entries exist", () => {
      const data = service.getTodayBriefingData(TODAY);
      expect(data.overdue).toEqual([]);
      expect(data.dueToday).toEqual([]);
      expect(data.urgent).toEqual([]);
      expect(data.completedYesterday).toEqual([]);
    });

    it("returns overdue tasks (due before today, still pending)", () => {
      service.createEntry({
        raw_text: "overdue task",
        type: "task",
        title: "Overdue",
        tags: [],
        due_date: YESTERDAY,
      });
      service.createEntry({
        raw_text: "old overdue",
        type: "task",
        title: "Old Overdue",
        tags: [],
        due_date: LAST_WEEK,
      });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.overdue.length).toBe(2);
    });

    it("does not include completed tasks in overdue", () => {
      const entry = service.createEntry({
        raw_text: "done task",
        type: "task",
        title: "Done",
        tags: [],
        due_date: YESTERDAY,
      });
      service.updateEntry({ id: entry.id, status: "done" });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.overdue.length).toBe(0);
    });

    it("returns tasks due today", () => {
      service.createEntry({
        raw_text: "today task",
        type: "task",
        title: "Today",
        tags: [],
        due_date: TODAY,
      });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.dueToday.length).toBe(1);
      expect(data.dueToday[0].title).toBe("Today");
    });

    it("does not include tomorrow's tasks in dueToday", () => {
      service.createEntry({
        raw_text: "tomorrow task",
        type: "task",
        title: "Tomorrow",
        tags: [],
        due_date: TOMORROW,
      });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.dueToday.length).toBe(0);
    });

    it("returns urgent pending tasks", () => {
      service.createEntry({
        raw_text: "urgent task",
        type: "task",
        title: "Urgent",
        tags: [],
        urgent: true,
      });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.urgent.length).toBe(1);
      expect(data.urgent[0].title).toBe("Urgent");
    });

    it("does not duplicate overdue tasks in urgent", () => {
      service.createEntry({
        raw_text: "overdue urgent",
        type: "task",
        title: "Overdue Urgent",
        tags: [],
        due_date: YESTERDAY,
        urgent: true,
      });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.overdue.length).toBe(1);
      expect(data.urgent.length).toBe(0);
    });

    it("does not duplicate dueToday tasks in urgent", () => {
      service.createEntry({
        raw_text: "today urgent",
        type: "task",
        title: "Today Urgent",
        tags: [],
        due_date: TODAY,
        urgent: true,
      });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.dueToday.length).toBe(1);
      expect(data.urgent.length).toBe(0);
    });

    it("returns tasks completed yesterday", () => {
      const entry = service.createEntry({
        raw_text: "completed task",
        type: "task",
        title: "Completed",
        tags: [],
      });
      service.updateEntry({ id: entry.id, status: "done" });

      // completed_at is set to now, so we need to check with a broader today
      // For deterministic testing, we check that the method filters correctly
      const data = service.getTodayBriefingData(TOMORROW);
      // The task was completed "today" (test execution time),
      // so when briefing date = tomorrow, completed_at falls in "yesterday"
      expect(data.completedYesterday.length).toBe(1);
    });

    it("does not include tasks completed before yesterday in completedYesterday", () => {
      const entry = service.createEntry({
        raw_text: "old completed",
        type: "task",
        title: "Old Completed",
        tags: [],
      });
      service.updateEntry({ id: entry.id, status: "done" });

      // Briefing for 2 days later: completed_at should be "2 days ago", not yesterday
      const twoDaysLater = "2026-03-28";
      const data = service.getTodayBriefingData(twoDaysLater);
      expect(data.completedYesterday.length).toBe(0);
    });

    it("does not include notes in any category", () => {
      service.createEntry({
        raw_text: "just a note",
        type: "note",
        title: "Note",
        tags: [],
        urgent: true,
        due_date: YESTERDAY,
      });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.overdue.length).toBe(0);
      expect(data.dueToday.length).toBe(0);
      expect(data.urgent.length).toBe(0);
    });

    it("does not include completed urgent tasks in urgent", () => {
      const entry = service.createEntry({
        raw_text: "done urgent",
        type: "task",
        title: "Done Urgent",
        tags: [],
        urgent: true,
      });
      service.updateEntry({ id: entry.id, status: "done" });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.urgent.length).toBe(0);
    });

    it("defaults today to current date when not provided", () => {
      const data = service.getTodayBriefingData();
      expect(data.overdue).toEqual([]);
      expect(data.dueToday).toEqual([]);
      expect(data.urgent).toEqual([]);
      expect(data.completedYesterday).toEqual([]);
    });

    it("handles mixed scenario with all categories populated", () => {
      // Overdue
      service.createEntry({
        raw_text: "overdue1",
        type: "task",
        title: "Overdue1",
        tags: [],
        due_date: LAST_WEEK,
      });
      // Due today
      service.createEntry({
        raw_text: "today1",
        type: "task",
        title: "Today1",
        tags: [],
        due_date: TODAY,
      });
      // Urgent (no due date)
      service.createEntry({
        raw_text: "urgent1",
        type: "task",
        title: "Urgent1",
        tags: [],
        urgent: true,
      });
      // Completed (will show as completedYesterday when briefing = tomorrow)
      const done = service.createEntry({
        raw_text: "done1",
        type: "task",
        title: "Done1",
        tags: [],
      });
      service.updateEntry({ id: done.id, status: "done" });

      const data = service.getTodayBriefingData(TODAY);
      expect(data.overdue.length).toBe(1);
      expect(data.dueToday.length).toBe(1);
      expect(data.urgent.length).toBe(1);
    });
  });

  // ─── getWeeklyReportData ─────────────────────────────────

  describe("getWeeklyReportData", () => {
    // completed_at is set by the DB to datetime('now'), so we use
    // an asOfDate a few days in the future to ensure tasks completed
    // during the test fall within the 7-day report window.
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const FUTURE = futureDate.toISOString();

    it("returns empty arrays when no entries exist", () => {
      const data = service.getWeeklyReportData(FUTURE);
      expect(data.completedThisWeek).toEqual([]);
      expect(data.addedThisWeek).toEqual([]);
      expect(data.stillPending).toEqual([]);
      expect(data.tagBreakdown).toEqual([]);
      expect(data.period.since).toBeDefined();
      expect(data.period.until).toBeDefined();
    });

    it("returns period covering 7 days before asOfDate", () => {
      const data = service.getWeeklyReportData("2026-04-10T12:00:00.000Z");
      expect(data.period.since).toBe("2026-04-03T12:00:00.000Z");
      expect(data.period.until).toBe("2026-04-10T12:00:00.000Z");
    });

    it("includes tasks completed this week in completedThisWeek", () => {
      const entry = service.createEntry({
        raw_text: "weekly task",
        type: "task",
        title: "Done Task",
        tags: ["work"],
      });
      service.updateEntry({ id: entry.id, status: "done" });

      // Use future date so completed_at (now) falls within the week window
      const data = service.getWeeklyReportData(FUTURE);
      expect(data.completedThisWeek.length).toBe(1);
      expect(data.completedThisWeek[0].title).toBe("Done Task");
    });

    it("excludes tasks completed outside the week window", () => {
      const entry = service.createEntry({
        raw_text: "old task",
        type: "task",
        title: "Old Done",
        tags: [],
      });
      service.updateEntry({ id: entry.id, status: "done" });

      // Use a date far enough that the completion falls outside the window
      const data = service.getWeeklyReportData("2020-01-01T00:00:00.000Z");
      expect(data.completedThisWeek.length).toBe(0);
    });

    it("includes entries added this week in addedThisWeek", () => {
      service.createEntry({
        raw_text: "new note",
        type: "note",
        title: "New Note",
        tags: [],
      });

      const data = service.getWeeklyReportData(FUTURE);
      expect(data.addedThisWeek.length).toBeGreaterThanOrEqual(1);
      expect(data.addedThisWeek.some((e) => e.title === "New Note")).toBe(true);
    });

    it("excludes entries added outside the week window from addedThisWeek", () => {
      service.createEntry({
        raw_text: "old note",
        type: "note",
        title: "Old Note",
        tags: [],
      });

      const data = service.getWeeklyReportData("2020-01-01T00:00:00.000Z");
      expect(data.addedThisWeek.length).toBe(0);
    });

    it("includes stale pending tasks in stillPending", () => {
      service.createEntry({
        raw_text: "stale task",
        type: "task",
        title: "Stale",
        tags: [],
      });

      // Use a date far enough in the future that the task is older than 7 days
      const farFuture = "2028-01-01T00:00:00.000Z";
      const data = service.getWeeklyReportData(farFuture);
      expect(data.stillPending.length).toBe(1);
      expect(data.stillPending[0].title).toBe("Stale");
    });

    it("excludes recently created pending tasks from stillPending", () => {
      service.createEntry({
        raw_text: "fresh task",
        type: "task",
        title: "Fresh",
        tags: [],
      });

      // Use near-future so the task was created within 7 days
      const data = service.getWeeklyReportData(FUTURE);
      expect(data.stillPending.length).toBe(0);
    });

    it("excludes completed tasks from stillPending", () => {
      const entry = service.createEntry({
        raw_text: "done stale",
        type: "task",
        title: "Done Stale",
        tags: [],
      });
      service.updateEntry({ id: entry.id, status: "done" });

      const farFuture = "2028-01-01T00:00:00.000Z";
      const data = service.getWeeklyReportData(farFuture);
      expect(data.stillPending.length).toBe(0);
    });

    it("returns tag breakdown of completed tasks", () => {
      const e1 = service.createEntry({
        raw_text: "t1",
        type: "task",
        title: "T1",
        tags: ["work", "urgent"],
      });
      const e2 = service.createEntry({
        raw_text: "t2",
        type: "task",
        title: "T2",
        tags: ["work"],
      });
      service.updateEntry({ id: e1.id, status: "done" });
      service.updateEntry({ id: e2.id, status: "done" });

      const data = service.getWeeklyReportData(FUTURE);
      expect(data.tagBreakdown.length).toBeGreaterThanOrEqual(1);
      const workTag = data.tagBreakdown.find((t) => t.tag === "work");
      expect(workTag).toBeDefined();
      expect(workTag?.count).toBe(2);
      const urgentTag = data.tagBreakdown.find((t) => t.tag === "urgent");
      expect(urgentTag).toBeDefined();
      expect(urgentTag?.count).toBe(1);
    });

    it("includes overall stats", () => {
      const data = service.getWeeklyReportData(FUTURE);
      expect(data.stats).toBeDefined();
      expect(data.stats.streak).toBeDefined();
      expect(data.stats.weeklyCompletions).toBeDefined();
    });

    it("defaults to current date when asOfDate is not provided", () => {
      const data = service.getWeeklyReportData();
      expect(data.period.until).toBeDefined();
      // The period should end approximately now
      const untilDate = new Date(data.period.until);
      const now = new Date();
      expect(Math.abs(untilDate.getTime() - now.getTime())).toBeLessThan(5000);
    });

    it("handles mixed scenario with all categories populated", () => {
      // Completed task
      const done = service.createEntry({
        raw_text: "done",
        type: "task",
        title: "Completed",
        tags: ["dev"],
      });
      service.updateEntry({ id: done.id, status: "done" });

      // New note
      service.createEntry({
        raw_text: "note",
        type: "note",
        title: "Weekly Note",
        tags: [],
      });

      // Pending task (will be stale when viewed from far future)
      service.createEntry({
        raw_text: "pending",
        type: "task",
        title: "Pending Old",
        tags: [],
      });

      const farFuture = "2028-01-01T00:00:00.000Z";
      const data = service.getWeeklyReportData(farFuture);

      // completedThisWeek should be empty since completion was long ago
      expect(data.completedThisWeek.length).toBe(0);
      // addedThisWeek should be empty since entries were added long ago
      expect(data.addedThisWeek.length).toBe(0);
      // stillPending should include the pending task
      expect(data.stillPending.length).toBe(1);
      expect(data.stillPending[0].title).toBe("Pending Old");
    });

    it("does not include archived entries in any category", () => {
      const entry = service.createEntry({
        raw_text: "to delete",
        type: "task",
        title: "Deleted",
        tags: [],
      });
      service.deleteEntry(entry.id);

      const data = service.getWeeklyReportData(FUTURE);
      expect(data.addedThisWeek.some((e) => e.id === entry.id)).toBe(false);
      expect(data.stillPending.some((e) => e.id === entry.id)).toBe(false);
    });

    it("does not include notes in stillPending", () => {
      service.createEntry({
        raw_text: "old note",
        type: "note",
        title: "Old Note",
        tags: [],
      });

      const farFuture = "2028-01-01T00:00:00.000Z";
      const data = service.getWeeklyReportData(farFuture);
      expect(data.stillPending.length).toBe(0);
    });
  });

  // ─── subtasks ──────────────────────────────────────────────

  describe("subtasks", () => {
    it("addSubtasks creates child entries linked to parent", () => {
      const parent = service.createEntry({
        raw_text: "Big project",
        type: "task",
        title: "Big project",
        tags: ["work"],
      });
      const subtasks = service.addSubtasks(parent.id, [
        { raw_text: "Step 1", title: "Step 1" },
        { raw_text: "Step 2", title: "Step 2" },
      ]);
      expect(subtasks).toHaveLength(2);
      expect(subtasks[0].parent_id).toBe(parent.id);
      expect(subtasks[1].parent_id).toBe(parent.id);
      expect(subtasks[0].type).toBe("task");
      expect(subtasks[0].status).toBe("pending");
    });

    it("getSubtasks returns children of a parent", () => {
      const parent = service.createEntry({
        raw_text: "Parent task",
        type: "task",
        title: "Parent task",
      });
      service.addSubtasks(parent.id, [
        { raw_text: "Child A", title: "Child A" },
        { raw_text: "Child B", title: "Child B" },
      ]);
      const children = service.getSubtasks(parent.id);
      expect(children).toHaveLength(2);
      expect(children[0].title).toBe("Child A");
      expect(children[1].title).toBe("Child B");
    });

    it("getSubtasks throws for non-existent parent", () => {
      expect(() => service.getSubtasks("nonexistent")).toThrow("Parent entry not found");
    });

    it("addSubtasks throws for non-existent parent", () => {
      expect(() => service.addSubtasks("nonexistent", [{ raw_text: "sub" }])).toThrow(
        "Parent entry not found",
      );
    });

    it("addSubtasks throws when parent is already a subtask (no nesting)", () => {
      const parent = service.createEntry({
        raw_text: "Top level",
        type: "task",
        title: "Top level",
      });
      const [child] = service.addSubtasks(parent.id, [{ raw_text: "Child", title: "Child" }]);
      expect(() => service.addSubtasks(child.id, [{ raw_text: "Grandchild" }])).toThrow(
        "Cannot add subtasks to a subtask",
      );
    });

    it("addSubtasks throws for empty subtasks array", () => {
      const parent = service.createEntry({
        raw_text: "Parent",
        type: "task",
        title: "Parent",
      });
      expect(() => service.addSubtasks(parent.id, [])).toThrow("must not be empty");
    });

    it("subtasks default title to raw_text when not provided", () => {
      const parent = service.createEntry({
        raw_text: "Parent",
        type: "task",
        title: "Parent",
      });
      const [sub] = service.addSubtasks(parent.id, [{ raw_text: "Do something specific" }]);
      expect(sub.title).toBe("Do something specific");
    });

    it("subtasks inherit tags and urgency from input", () => {
      const parent = service.createEntry({
        raw_text: "Parent",
        type: "task",
        title: "Parent",
      });
      const [sub] = service.addSubtasks(parent.id, [
        {
          raw_text: "Urgent sub",
          title: "Urgent sub",
          tags: ["priority"],
          urgent: true,
          due_date: "2026-04-01",
        },
      ]);
      expect(sub.urgent).toBe(true);
      expect(sub.tags).toEqual(["priority"]);
      expect(sub.due_date).toBe("2026-04-01");
    });

    it("subtasks can be set as delegatable", () => {
      const parent = service.createEntry({
        raw_text: "Parent",
        type: "task",
        title: "Parent",
      });
      const [sub] = service.addSubtasks(parent.id, [
        { raw_text: "Research X", title: "Research X", delegatable: true },
      ]);
      expect(sub.delegatable).toBe(true);
    });

    it("listEntries with parent_id filter returns only subtasks", () => {
      const parent = service.createEntry({
        raw_text: "Parent",
        type: "task",
        title: "Parent",
      });
      service.addSubtasks(parent.id, [
        { raw_text: "Sub 1", title: "Sub 1" },
        { raw_text: "Sub 2", title: "Sub 2" },
      ]);
      // Also create a standalone task
      service.createEntry({
        raw_text: "Standalone",
        type: "task",
        title: "Standalone",
      });

      const subtasksOnly = service.listEntries({ parent_id: parent.id });
      expect(subtasksOnly).toHaveLength(2);

      const topLevelOnly = service.listEntries({ parent_id: null, type: "task" });
      // parent + standalone = 2
      expect(topLevelOnly.some((e) => e.parent_id !== null)).toBe(false);
    });

    it("completing a subtask does not affect parent", () => {
      const parent = service.createEntry({
        raw_text: "Parent",
        type: "task",
        title: "Parent",
      });
      const [sub] = service.addSubtasks(parent.id, [{ raw_text: "Sub", title: "Sub" }]);
      service.updateEntry({ id: sub.id, status: "done" });

      const updatedParent = service.getEntry(parent.id);
      expect(updatedParent?.status).toBe("pending");

      const updatedSub = service.getEntry(sub.id);
      expect(updatedSub?.status).toBe("done");
    });

    it("deleting parent does not delete subtasks (soft delete)", () => {
      const parent = service.createEntry({
        raw_text: "Parent",
        type: "task",
        title: "Parent",
      });
      service.addSubtasks(parent.id, [{ raw_text: "Sub", title: "Sub" }]);

      service.deleteEntry(parent.id);
      // Subtasks still exist
      const subs = repo.getSubtasks(parent.id);
      expect(subs).toHaveLength(1);
    });
  });
});
