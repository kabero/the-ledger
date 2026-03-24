import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { EntryRepository } from "./repository.js";
import type {
  CreateEntryInput,
  Entry,
  ListEntriesFilter,
  SubmitProcessedInput,
  UpdateEntryInput,
} from "./types.js";

const IMAGES_DIR = path.join(os.homedir(), ".theledger", "images");
const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

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
    if (!ALLOWED_EXTENSIONS.includes(normalizedExt)) {
      throw new Error(
        `Unsupported image format: ${normalizedExt}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
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
}
