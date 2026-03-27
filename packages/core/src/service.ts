import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { EntryRepository } from "./repository.js";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  type CreateEntryInput,
  type Entry,
  type ListEntriesFilter,
  MAX_IMAGE_SIZE,
  type ResultType,
  type SubmitProcessedInput,
  type UpdateEntryInput,
} from "./types.js";

const IMAGES_DIR = path.join(os.homedir(), ".theledger", "images");

const URL_PATTERN = /https?:\/\/\S+/i;
const RESEARCH_KEYWORDS =
  /\b(調査|調べ|リサーチ|research|findings?|analysis|分析|考察|検討|比較)\b/i;
const SUMMARY_KEYWORDS = /\b(まとめ|要約|概要|summary|overview|recap|結論|conclusion)\b/i;

export function detectResultType(result: string | null | undefined): ResultType | null {
  if (!result) return null;
  if (URL_PATTERN.test(result)) return "url";
  if (RESEARCH_KEYWORDS.test(result)) return "research";
  if (SUMMARY_KEYWORDS.test(result)) return "summary";
  return "generic";
}

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
    if (input.result !== undefined && input.result_type === undefined) {
      input.result_type = detectResultType(input.result);
    }
    return this.repository.update(input);
  }

  completeTask(id: string, result: string, resultType?: ResultType | null): Entry | null {
    const resolvedType = resultType ?? detectResultType(result);
    return this.repository.update({
      id,
      status: "done",
      result,
      result_type: resolvedType,
    });
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

  createEntryWithImage(rawText: string, imageData: Buffer, ext: string): Entry {
    const tempId = uuidv4();
    const imagePath = this.saveImage(imageData, tempId, ext);
    return this.repository.create({ raw_text: rawText || "(画像)", image_path: imagePath });
  }
}
