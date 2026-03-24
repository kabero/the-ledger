import type {
  Entry,
  CreateEntryInput,
  SubmitProcessedInput,
  UpdateEntryInput,
  ListEntriesFilter,
} from "./types.js";
import type { EntryRepository } from "./repository.js";

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
}
