import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { EntryRepository } from "./repository.js";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_RESULT_FILE_EXTENSIONS,
  type CreateEntryInput,
  type Entry,
  type ListEntriesFilter,
  MAX_IMAGE_SIZE,
  MAX_RESULT_FILE_SIZE,
  type SubmitProcessedInput,
  type UpdateEntryInput,
} from "./types.js";

const IMAGES_DIR = path.join(os.homedir(), ".theledger", "images");
const RESULTS_DIR = path.join(os.homedir(), ".theledger", "results");

export class EntryService {
  constructor(private repository: EntryRepository) {}

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

  getTodayTasks(limit: number = 3): Entry[] {
    return this.repository.getTodayTasks(limit);
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

  saveResultFile(data: Buffer, entryId: string, originalName: string): string {
    const ext = path.extname(originalName).slice(1).toLowerCase();
    if (
      !ALLOWED_RESULT_FILE_EXTENSIONS.includes(
        ext as (typeof ALLOWED_RESULT_FILE_EXTENSIONS)[number],
      )
    ) {
      throw new Error(
        `Unsupported result file format: ${ext}. Allowed: ${ALLOWED_RESULT_FILE_EXTENSIONS.join(", ")}`,
      );
    }
    if (data.length > MAX_RESULT_FILE_SIZE) {
      throw new Error(
        `Result file too large: ${(data.length / 1024 / 1024).toFixed(1)}MB. Max: 50MB`,
      );
    }
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    const sanitizedName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${entryId}_${sanitizedName}`;
    const filePath = path.join(RESULTS_DIR, filename);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  copyResultFile(sourcePath: string, entryId: string): string {
    const resolvedSource = path.resolve(sourcePath);
    if (!fs.existsSync(resolvedSource)) {
      throw new Error(`Source file not found: ${resolvedSource}`);
    }
    const originalName = path.basename(resolvedSource);
    const data = fs.readFileSync(resolvedSource);
    return this.saveResultFile(data, entryId, originalName);
  }

  createEntryWithImage(rawText: string, imageData: Buffer, ext: string): Entry {
    const tempId = uuidv4();
    const imagePath = this.saveImage(imageData, tempId, ext);
    return this.repository.create({ raw_text: rawText || "(画像)", image_path: imagePath });
  }
}
