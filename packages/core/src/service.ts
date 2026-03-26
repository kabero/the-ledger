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

/** Known image magic bytes signatures */
const IMAGE_SIGNATURES: Record<string, number[][]> = {
  png: [[0x89, 0x50, 0x4e, 0x47]], // \x89PNG
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  gif: [
    [0x47, 0x49, 0x46, 0x38, 0x37], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39], // GIF89a
  ],
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF (WebP container)
};

function validateImageMagicBytes(data: Buffer, ext: string): boolean {
  const signatures = IMAGE_SIGNATURES[ext];
  if (!signatures) return false;
  return signatures.some((sig) => {
    if (data.length < sig.length) return false;
    return sig.every((byte, i) => data[i] === byte);
  });
}

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

  markAllResultsSeen(): number {
    return this.repository.markAllResultsSeen();
  }

  deleteEntry(id: string): boolean {
    // Clean up image file before deleting DB record
    const entry = this.repository.getById(id);
    if (entry?.image_path) {
      try {
        if (fs.existsSync(entry.image_path)) {
          fs.unlinkSync(entry.image_path);
        }
      } catch {
        // Ignore file deletion errors — DB record should still be deleted
      }
    }
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
    // Validate magic bytes match claimed extension
    if (!validateImageMagicBytes(data, normalizedExt)) {
      throw new Error(
        `Image content does not match extension .${normalizedExt}. File may be corrupted or spoofed.`,
      );
    }
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
    const filePath = path.join(IMAGES_DIR, `${entryId}.${normalizedExt}`);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  createEntryWithImage(
    imageData: Buffer,
    ext: string,
    input: Omit<CreateEntryInput, "image_path"> = { raw_text: "(画像)" },
  ): Entry {
    const tempId = uuidv4();
    const imagePath = this.saveImage(imageData, tempId, ext);
    return this.repository.create({
      ...input,
      raw_text: input.raw_text || "(画像)",
      image_path: imagePath,
    });
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
      try {
        const entry = this.repository.runInTransaction(() => {
          const created = this.createEntry({ raw_text: task.raw_text });
          repo.markRun(task.id);
          return created;
        });
        createdEntries.push(entry);
      } catch (err) {
        console.error(`Failed to run scheduled task ${task.id}:`, err);
        // Continue with remaining tasks instead of aborting
      }
    }
    return createdEntries;
  }
}
