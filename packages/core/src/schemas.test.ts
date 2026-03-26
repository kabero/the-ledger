import { describe, expect, it } from "vitest";
import {
  bulkTagRenameInputSchema,
  createEntryInputSchema,
  createScheduledTaskInputSchema,
  listEntriesFilterSchema,
  mergeTagsInputSchema,
  reopenTaskInputSchema,
  submitProcessedInputSchema,
  updateEntryInputSchema,
  updateScheduledTaskInputSchema,
} from "./schemas.js";

describe("createEntryInputSchema", () => {
  it("accepts minimal valid input", () => {
    const result = createEntryInputSchema.safeParse({ raw_text: "hello" });
    expect(result.success).toBe(true);
  });

  it("accepts fully populated input", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "buy milk",
      type: "task",
      title: "Buy milk",
      tags: ["grocery"],
      urgent: true,
      due_date: "2026-12-31",
      delegatable: true,
      source: "slack",
      result: "Done!",
      result_url: "https://example.com",
      decision_options: ["A", "B"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty raw_text", () => {
    const result = createEntryInputSchema.safeParse({ raw_text: "" });
    expect(result.success).toBe(false);
  });

  it("rejects raw_text over 50000 chars", () => {
    const result = createEntryInputSchema.safeParse({ raw_text: "a".repeat(50_001) });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "test",
      type: "task",
      title: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid due_date format", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "test",
      due_date: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null due_date", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "test",
      due_date: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid entry type", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "test",
      type: "invalid",
      title: "Test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 decision_options", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "test",
      decision_options: Array.from({ length: 21 }, (_, i) => `option-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("rejects type without title", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "test",
      type: "task",
    });
    expect(result.success).toBe(false);
  });

  it("accepts type with title", () => {
    const result = createEntryInputSchema.safeParse({
      raw_text: "test",
      type: "task",
      title: "A task",
    });
    expect(result.success).toBe(true);
  });
});

describe("submitProcessedInputSchema", () => {
  it("accepts valid input", () => {
    const result = submitProcessedInputSchema.safeParse({
      id: "abc-123",
      type: "task",
      title: "Buy milk",
      tags: ["grocery"],
      urgent: false,
      due_date: null,
      delegatable: false,
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults for urgent and delegatable", () => {
    const result = submitProcessedInputSchema.safeParse({
      id: "abc-123",
      type: "task",
      title: "Buy milk",
      tags: ["grocery"],
      due_date: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.urgent).toBe(false);
      expect(result.data.delegatable).toBe(false);
    }
  });

  it("rejects missing required fields", () => {
    const result = submitProcessedInputSchema.safeParse({
      id: "abc-123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = submitProcessedInputSchema.safeParse({
      id: "abc-123",
      type: "task",
      title: "",
      tags: [],
      due_date: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("updateEntryInputSchema", () => {
  it("accepts minimal input (id only)", () => {
    const result = updateEntryInputSchema.safeParse({ id: "abc-123" });
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = updateEntryInputSchema.safeParse({
      id: "abc-123",
      title: "Updated",
      tags: ["new-tag"],
      urgent: true,
      due_date: "2026-12-31",
      status: "done",
      type: "task",
      delegatable: true,
      result: "Done!",
      result_url: "https://example.com",
      result_seen: true,
      decision_selected: 0,
      decision_comment: "Good choice",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null decision_selected", () => {
    const result = updateEntryInputSchema.safeParse({
      id: "abc-123",
      decision_selected: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer decision_selected", () => {
    const result = updateEntryInputSchema.safeParse({
      id: "abc-123",
      decision_selected: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    const result = updateEntryInputSchema.safeParse({
      id: "abc-123",
      title: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe("listEntriesFilterSchema", () => {
  it("accepts empty object", () => {
    const result = listEntriesFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts all filter fields", () => {
    const result = listEntriesFilterSchema.safeParse({
      type: "task",
      status: "pending",
      tag: "work",
      query: "search term",
      processed: true,
      delegatable: true,
      source: "slack",
      since: "2026-01-01",
      until: "2026-12-31",
      includeArchived: false,
      limit: 50,
      offset: 10,
      sort: "completed_at",
      cursor: "2026-01-01|42",
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit over 100", () => {
    const result = listEntriesFilterSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects negative offset", () => {
    const result = listEntriesFilterSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid sort value", () => {
    const result = listEntriesFilterSchema.safeParse({ sort: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("createScheduledTaskInputSchema", () => {
  it("accepts valid daily task", () => {
    const result = createScheduledTaskInputSchema.safeParse({
      raw_text: "standup",
      frequency: "daily",
    });
    expect(result.success).toBe(true);
  });

  it("accepts weekly task with day_of_week", () => {
    const result = createScheduledTaskInputSchema.safeParse({
      raw_text: "review",
      frequency: "weekly",
      day_of_week: 1,
      hour: 9,
    });
    expect(result.success).toBe(true);
  });

  it("accepts monthly task with day_of_month", () => {
    const result = createScheduledTaskInputSchema.safeParse({
      raw_text: "report",
      frequency: "monthly",
      day_of_month: 15,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty raw_text", () => {
    const result = createScheduledTaskInputSchema.safeParse({
      raw_text: "",
      frequency: "daily",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid frequency", () => {
    const result = createScheduledTaskInputSchema.safeParse({
      raw_text: "task",
      frequency: "hourly",
    });
    expect(result.success).toBe(false);
  });

  it("rejects hour out of range", () => {
    expect(
      createScheduledTaskInputSchema.safeParse({
        raw_text: "task",
        frequency: "daily",
        hour: 24,
      }).success,
    ).toBe(false);
    expect(
      createScheduledTaskInputSchema.safeParse({
        raw_text: "task",
        frequency: "daily",
        hour: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects day_of_week out of range", () => {
    expect(
      createScheduledTaskInputSchema.safeParse({
        raw_text: "task",
        frequency: "weekly",
        day_of_week: 7,
      }).success,
    ).toBe(false);
  });

  it("rejects day_of_month out of range", () => {
    expect(
      createScheduledTaskInputSchema.safeParse({
        raw_text: "task",
        frequency: "monthly",
        day_of_month: 32,
      }).success,
    ).toBe(false);
    expect(
      createScheduledTaskInputSchema.safeParse({
        raw_text: "task",
        frequency: "monthly",
        day_of_month: 0,
      }).success,
    ).toBe(false);
  });
});

describe("updateScheduledTaskInputSchema", () => {
  it("accepts minimal input (id only)", () => {
    const result = updateScheduledTaskInputSchema.safeParse({ id: "abc-123" });
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = updateScheduledTaskInputSchema.safeParse({
      id: "abc-123",
      raw_text: "updated",
      frequency: "weekly",
      day_of_week: 3,
      day_of_month: null,
      hour: 14,
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty raw_text when provided", () => {
    const result = updateScheduledTaskInputSchema.safeParse({
      id: "abc-123",
      raw_text: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("reopenTaskInputSchema", () => {
  it("accepts id only", () => {
    const result = reopenTaskInputSchema.safeParse({ id: "abc-123" });
    expect(result.success).toBe(true);
  });

  it("accepts id with feedback", () => {
    const result = reopenTaskInputSchema.safeParse({
      id: "abc-123",
      feedback: "This was wrong",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = reopenTaskInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects feedback longer than 10000 chars", () => {
    const result = reopenTaskInputSchema.safeParse({
      id: "abc-123",
      feedback: "x".repeat(10001),
    });
    expect(result.success).toBe(false);
  });
});

describe("bulkTagRenameInputSchema", () => {
  it("accepts valid old and new tags", () => {
    const result = bulkTagRenameInputSchema.safeParse({
      old_tag: "foo",
      new_tag: "bar",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty old_tag", () => {
    const result = bulkTagRenameInputSchema.safeParse({
      old_tag: "",
      new_tag: "bar",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty new_tag", () => {
    const result = bulkTagRenameInputSchema.safeParse({
      old_tag: "foo",
      new_tag: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects tags longer than 20 chars", () => {
    const result = bulkTagRenameInputSchema.safeParse({
      old_tag: "a".repeat(21),
      new_tag: "bar",
    });
    expect(result.success).toBe(false);
  });
});

describe("mergeTagsInputSchema", () => {
  it("accepts valid source and target", () => {
    const result = mergeTagsInputSchema.safeParse({
      source_tags: ["a", "b"],
      target_tag: "c",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty source_tags array", () => {
    const result = mergeTagsInputSchema.safeParse({
      source_tags: [],
      target_tag: "c",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty target_tag", () => {
    const result = mergeTagsInputSchema.safeParse({
      source_tags: ["a"],
      target_tag: "",
    });
    expect(result.success).toBe(false);
  });
});
