import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { EntryRepository } from "./repository.js";
import type { ScheduledTaskRepository } from "./scheduled-task-repository.js";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  type CreateEntryInput,
  type CreateScheduledTaskInput,
  type Entry,
  type ListEntriesFilter,
  MAX_IMAGE_SIZE,
  type ScheduledTask,
  type SubmitProcessedInput,
  type UpdateEntryInput,
  type UpdateScheduledTaskInput,
} from "./types.js";

const IMAGES_DIR = path.join(os.homedir(), ".theledger", "images");

export class EntryService {
  constructor(
    private repository: EntryRepository,
    private scheduledTaskRepository?: ScheduledTaskRepository,
  ) {}

  createEntry(input: CreateEntryInput): Entry {
    return this.repository.create(input);
  }

  getEntry(id: string): Entry | null {
    return this.repository.getById(id);
  }

  listEntries(filter: ListEntriesFilter = {}): Entry[] {
    return this.repository.list(filter);
  }

  getUnprocessed(limit: number = 20): Entry[] {
    return this.repository.getUnprocessed(limit);
  }

  submitProcessed(input: SubmitProcessedInput): Entry {
    return this.repository.submitProcessed(input);
  }

  updateEntry(input: UpdateEntryInput): Entry | null {
    return this.repository.update(input);
  }

  deleteEntry(id: string): boolean {
    return this.repository.delete(id);
  }

  saveImage(data: Buffer, entryId: string, ext: string): string {
    const normalizedExt = ext.toLowerCase().replace(/^\./, "");
    if (
      !ALLOWED_IMAGE_EXTENSIONS.includes(normalizedExt as (typeof ALLOWED_IMAGE_EXTENSIONS)[number])
    ) {
      throw new Error(
        `Unsupported image format: ${normalizedExt}. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`,
      );
    }
    if (data.length > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${(data.length / 1024 / 1024).toFixed(1)}MB. Max: 10MB`);
    }
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
    const filePath = path.join(IMAGES_DIR, `${entryId}.${normalizedExt}`);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  createEntryWithImage(rawText: string, imageData: Buffer, ext: string): Entry {
    const tempId = uuidv4();
    const imagePath = this.saveImage(imageData, tempId, ext);
    return this.repository.create({ raw_text: rawText || "(画像)", image_path: imagePath });
  }

  private ensureScheduledTaskRepo(): ScheduledTaskRepository {
    if (!this.scheduledTaskRepository) {
      throw new Error("ScheduledTaskRepository is not configured");
    }
    return this.scheduledTaskRepository;
  }

  createScheduledTask(input: CreateScheduledTaskInput): ScheduledTask {
    return this.ensureScheduledTaskRepo().create(input);
  }

  listScheduledTasks(): ScheduledTask[] {
    return this.ensureScheduledTaskRepo().list();
  }

  getScheduledTask(id: string): ScheduledTask | null {
    return this.ensureScheduledTaskRepo().getById(id);
  }

  updateScheduledTask(input: UpdateScheduledTaskInput): ScheduledTask | null {
    return this.ensureScheduledTaskRepo().update(input);
  }

  deleteScheduledTask(id: string): boolean {
    return this.ensureScheduledTaskRepo().delete(id);
  }

  getTagVocabulary(): { tag: string; count: number }[] {
    return this.repository.getTagVocabulary();
  }

  getStats() {
    return this.repository.getStats();
  }

  runDueScheduledTasks(): Entry[] {
    const repo = this.ensureScheduledTaskRepo();
    const dueTasks = repo.getDue();
    const createdEntries: Entry[] = [];
    for (const task of dueTasks) {
      const entry = this.createEntry({ raw_text: task.raw_text });
      createdEntries.push(entry);
      repo.markRun(task.id);
    }
    return createdEntries;
  }
}
