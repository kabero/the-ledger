import type { EntryService } from "@theledger/core";
import {
  addSubtasksInputSchema,
  createScheduledTaskInputSchema,
  listEntriesFilterSchema,
  submitProcessedInputSchema,
  taskStatusSchema,
  updateEntryInputSchema,
  updateScheduledTaskInputSchema,
} from "@theledger/core";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

export interface Context {
  service: EntryService;
  [key: string]: unknown;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const appRouter = t.router({
  addEntry: t.procedure
    .input(
      z.object({
        raw_text: z.string().min(1),
        image: z.string().optional(),
        image_ext: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      if (input.image && input.image_ext) {
        const imageData = Buffer.from(input.image, "base64");
        return ctx.service.createEntryWithImage(imageData, input.image_ext, {
          raw_text: input.raw_text,
        });
      }
      return ctx.service.createEntry({ raw_text: input.raw_text });
    }),

  getEntry: t.procedure.input(z.object({ id: z.string() })).query(({ input, ctx }) => {
    return ctx.service.getEntry(input.id);
  }),

  listEntries: t.procedure.input(listEntriesFilterSchema.optional()).query(({ input, ctx }) => {
    return ctx.service.listEntries(input ?? {});
  }),

  listEntriesWithCursor: t.procedure
    .input(listEntriesFilterSchema.optional())
    .query(({ input, ctx }) => {
      return ctx.service.listEntriesWithCursor(input ?? {});
    }),

  countEntries: t.procedure
    .input(
      listEntriesFilterSchema
        .omit({ limit: true, offset: true, sort: true, cursor: true })
        .optional(),
    )
    .query(({ input, ctx }) => {
      return { count: ctx.service.countEntries(input ?? {}) };
    }),

  getUnprocessed: t.procedure
    .input(z.object({ limit: z.number().int().positive().max(50).optional() }).optional())
    .query(({ input, ctx }) => {
      return ctx.service.getUnprocessed(input?.limit);
    }),

  submitProcessed: t.procedure.input(submitProcessedInputSchema).mutation(({ input, ctx }) => {
    return ctx.service.submitProcessed(input);
  }),

  updateEntry: t.procedure.input(updateEntryInputSchema).mutation(({ input, ctx }) => {
    return ctx.service.updateEntry(input);
  }),

  markAllResultsSeen: t.procedure.mutation(({ ctx }) => {
    return { count: ctx.service.markAllResultsSeen() };
  }),

  deleteEntry: t.procedure.input(z.object({ id: z.string() })).mutation(({ input, ctx }) => {
    return ctx.service.deleteEntry(input.id);
  }),

  restoreEntry: t.procedure.input(z.object({ id: z.string() })).mutation(({ input, ctx }) => {
    return ctx.service.restoreEntry(input.id);
  }),

  bulkUpdateStatus: t.procedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(100),
        status: taskStatusSchema,
      }),
    )
    .mutation(({ input, ctx }) => {
      return { count: ctx.service.bulkUpdateStatus(input.ids, input.status) };
    }),

  bulkDelete: t.procedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(100) }))
    .mutation(({ input, ctx }) => {
      return { count: ctx.service.bulkDelete(input.ids) };
    }),

  getOverdueTasks: t.procedure
    .input(z.object({ before_date: z.string().optional() }).optional())
    .query(({ input, ctx }) => {
      return ctx.service.getOverdueTasks(input?.before_date);
    }),

  getTypeSummary: t.procedure.query(({ ctx }) => {
    return ctx.service.getTypeSummary();
  }),

  purgeTrash: t.procedure.mutation(({ ctx }) => {
    return { count: ctx.service.purgeTrash() };
  }),

  rebuildFtsIndex: t.procedure.mutation(({ ctx }) => {
    ctx.service.rebuildFtsIndex();
    return { ok: true };
  }),

  archiveCompleted: t.procedure
    .input(z.object({ older_than_days: z.number().int().positive().max(3650) }))
    .mutation(({ input, ctx }) => {
      return { count: ctx.service.archiveCompleted(input.older_than_days) };
    }),

  getStats: t.procedure.query(({ ctx }) => {
    return ctx.service.getStats();
  }),

  getRecentActivity: t.procedure
    .input(z.object({ limit: z.number().int().positive().max(100).optional() }).optional())
    .query(({ input, ctx }) => {
      return ctx.service.getRecentActivity(input?.limit);
    }),

  reopenTask: t.procedure
    .input(
      z.object({
        id: z.string(),
        feedback: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      return ctx.service.reopenTask(input.id, input.feedback);
    }),

  bulkTagRename: t.procedure
    .input(
      z.object({
        old_tag: z.string().min(1),
        new_tag: z.string().min(1),
      }),
    )
    .mutation(({ input, ctx }) => {
      return { count: ctx.service.bulkTagRename(input.old_tag, input.new_tag) };
    }),

  mergeTags: t.procedure
    .input(
      z.object({
        source_tags: z.array(z.string()).min(1),
        target_tag: z.string().min(1),
      }),
    )
    .mutation(({ input, ctx }) => {
      return { count: ctx.service.mergeTags(input.source_tags, input.target_tag) };
    }),

  exportEntries: t.procedure.input(listEntriesFilterSchema.optional()).query(({ input, ctx }) => {
    return ctx.service.exportEntries(input ?? {});
  }),

  getSubtasks: t.procedure.input(z.object({ parent_id: z.string() })).query(({ input, ctx }) => {
    return ctx.service.getSubtasks(input.parent_id);
  }),

  addSubtasks: t.procedure.input(addSubtasksInputSchema).mutation(({ input, ctx }) => {
    return ctx.service.addSubtasks(input.parent_id, input.subtasks);
  }),

  // スケジュールおつかい
  createScheduledTask: t.procedure
    .input(createScheduledTaskInputSchema)
    .mutation(({ input, ctx }) => {
      return ctx.service.createScheduledTask(input);
    }),

  listScheduledTasks: t.procedure.query(({ ctx }) => {
    return ctx.service.listScheduledTasks();
  }),

  updateScheduledTask: t.procedure
    .input(updateScheduledTaskInputSchema)
    .mutation(({ input, ctx }) => {
      return ctx.service.updateScheduledTask(input);
    }),

  deleteScheduledTask: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => {
      return ctx.service.deleteScheduledTask(input.id);
    }),

  runDueScheduledTasks: t.procedure.mutation(({ ctx }) => {
    return ctx.service.runDueScheduledTasks();
  }),
});

export type AppRouter = typeof appRouter;
