import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import { ScheduledTaskRepository } from "./scheduled-task-repository.js";

function createTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "theledger-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  return createDatabase(dbPath);
}

describe("ScheduledTaskRepository", () => {
  let db: Database.Database;
  let repo: ScheduledTaskRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new ScheduledTaskRepository(db);
  });

  // ─── create ───────────────────────────────────────────────

  describe("create", () => {
    it("creates a daily scheduled task with defaults", () => {
      const task = repo.create({ raw_text: "standup notes", frequency: "daily" });
      expect(task.id).toBeDefined();
      expect(task.raw_text).toBe("standup notes");
      expect(task.frequency).toBe("daily");
      expect(task.hour).toBe(8);
      expect(task.enabled).toBe(true);
      expect(task.day_of_week).toBeNull();
      expect(task.day_of_month).toBeNull();
      expect(task.last_run_at).toBeNull();
    });

    it("creates a weekly task with day_of_week", () => {
      const task = repo.create({
        raw_text: "weekly review",
        frequency: "weekly",
        day_of_week: 1,
        hour: 9,
      });
      expect(task.frequency).toBe("weekly");
      expect(task.day_of_week).toBe(1);
      expect(task.hour).toBe(9);
    });

    it("creates a monthly task with day_of_month", () => {
      const task = repo.create({
        raw_text: "monthly report",
        frequency: "monthly",
        day_of_month: 15,
        hour: 10,
      });
      expect(task.frequency).toBe("monthly");
      expect(task.day_of_month).toBe(15);
    });
  });

  // ─── list ─────────────────────────────────────────────────

  describe("list", () => {
    it("returns all tasks", () => {
      repo.create({ raw_text: "first", frequency: "daily" });
      repo.create({ raw_text: "second", frequency: "daily" });
      const tasks = repo.list();
      expect(tasks).toHaveLength(2);
      const texts = tasks.map((t) => t.raw_text).sort();
      expect(texts).toEqual(["first", "second"]);
    });

    it("returns empty array when no tasks", () => {
      expect(repo.list()).toEqual([]);
    });
  });

  // ─── getById ──────────────────────────────────────────────

  describe("getById", () => {
    it("returns task by id", () => {
      const created = repo.create({ raw_text: "find me", frequency: "daily" });
      const found = repo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found?.raw_text).toBe("find me");
    });

    it("returns null for non-existent id", () => {
      expect(repo.getById("non-existent")).toBeNull();
    });
  });

  // ─── update ───────────────────────────────────────────────

  describe("update", () => {
    it("updates raw_text", () => {
      const task = repo.create({ raw_text: "old text", frequency: "daily" });
      const updated = repo.update({ id: task.id, raw_text: "new text" });
      expect(updated?.raw_text).toBe("new text");
    });

    it("updates frequency", () => {
      const task = repo.create({ raw_text: "task", frequency: "daily" });
      const updated = repo.update({ id: task.id, frequency: "weekly", day_of_week: 3 });
      expect(updated?.frequency).toBe("weekly");
      expect(updated?.day_of_week).toBe(3);
    });

    it("disables a task", () => {
      const task = repo.create({ raw_text: "task", frequency: "daily" });
      expect(task.enabled).toBe(true);
      const updated = repo.update({ id: task.id, enabled: false });
      expect(updated?.enabled).toBe(false);
    });

    it("returns existing task when no fields to update", () => {
      const task = repo.create({ raw_text: "task", frequency: "daily" });
      const result = repo.update({ id: task.id });
      expect(result?.raw_text).toBe("task");
    });
  });

  // ─── delete ───────────────────────────────────────────────

  describe("delete", () => {
    it("deletes an existing task", () => {
      const task = repo.create({ raw_text: "task", frequency: "daily" });
      expect(repo.delete(task.id)).toBe(true);
      expect(repo.getById(task.id)).toBeNull();
    });

    it("returns false for non-existent task", () => {
      expect(repo.delete("non-existent")).toBe(false);
    });
  });

  // ─── markRun ──────────────────────────────────────────────

  describe("markRun", () => {
    it("sets last_run_at", () => {
      const task = repo.create({ raw_text: "task", frequency: "daily" });
      expect(task.last_run_at).toBeNull();
      repo.markRun(task.id);
      const updated = repo.getById(task.id);
      expect(updated?.last_run_at).not.toBeNull();
    });
  });

  // ─── getDue ────────────────────────────────────────────────

  describe("getDue", () => {
    it("excludes disabled tasks", () => {
      const now = new Date();
      const task = repo.create({
        raw_text: "disabled",
        frequency: "daily",
        hour: now.getHours(),
      });
      repo.update({ id: task.id, enabled: false });

      const due = repo.getDue();
      expect(due.find((t) => t.id === task.id)).toBeUndefined();
    });

    it("excludes tasks already run today", () => {
      const now = new Date();
      const task = repo.create({
        raw_text: "already ran",
        frequency: "daily",
        hour: now.getHours(),
      });
      repo.markRun(task.id);

      const due = repo.getDue();
      expect(due.find((t) => t.id === task.id)).toBeUndefined();
    });

    it("excludes tasks with different hour", () => {
      const now = new Date();
      const differentHour = (now.getHours() + 12) % 24; // 12 hours away
      repo.create({
        raw_text: "wrong hour",
        frequency: "daily",
        hour: differentHour,
      });

      const due = repo.getDue();
      expect(due.length).toBe(0);
    });

    it("includes daily task at current hour with no prior run", () => {
      const now = new Date();
      const task = repo.create({
        raw_text: "daily task",
        frequency: "daily",
        hour: now.getHours(),
      });

      const due = repo.getDue();
      const found = due.find((t) => t.id === task.id);
      expect(found).toBeDefined();
      expect(found?.raw_text).toBe("daily task");
    });

    it("weekly task only due on correct day_of_week", () => {
      const now = new Date();
      const wrongDay = (now.getDay() + 3) % 7; // 3 days off
      repo.create({
        raw_text: "wrong day",
        frequency: "weekly",
        day_of_week: wrongDay,
        hour: now.getHours(),
      });

      const due = repo.getDue();
      expect(due.length).toBe(0);
    });

    it("monthly task only due on correct day_of_month", () => {
      const now = new Date();
      // Use a day that definitely differs from today
      const wrongDom = now.getDate() === 28 ? 1 : 28;
      repo.create({
        raw_text: "wrong dom",
        frequency: "monthly",
        day_of_month: wrongDom,
        hour: now.getHours(),
      });

      const due = repo.getDue();
      expect(due.length).toBe(0);
    });
  });

  // ─── update edge cases ────────────────────────────────────

  describe("update edge cases", () => {
    it("updates hour", () => {
      const task = repo.create({ raw_text: "task", frequency: "daily", hour: 8 });
      const updated = repo.update({ id: task.id, hour: 14 });
      expect(updated?.hour).toBe(14);
    });

    it("updates day_of_week to null", () => {
      const task = repo.create({ raw_text: "task", frequency: "weekly", day_of_week: 3 });
      const updated = repo.update({ id: task.id, day_of_week: null });
      expect(updated?.day_of_week).toBeNull();
    });

    it("updates day_of_month", () => {
      const task = repo.create({ raw_text: "task", frequency: "monthly", day_of_month: 15 });
      const updated = repo.update({ id: task.id, day_of_month: 1 });
      expect(updated?.day_of_month).toBe(1);
    });

    it("returns null for non-existent id", () => {
      const result = repo.update({ id: "non-existent", raw_text: "x" });
      expect(result).toBeNull();
    });
  });
});
