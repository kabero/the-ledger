import { initTRPC } from "@trpc/server";
import { z } from "zod";
import superjson from "superjson";
import type { EntryService } from "@theledger/core";
import { ENTRY_TYPES, TASK_STATUSES } from "@theledger/core";

export interface Context {
  service: EntryService;
  [key: string]: unknown;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const entryTypeEnum = z.enum(ENTRY_TYPES);
const taskStatusEnum = z.enum(TASK_STATUSES);

export const appRouter = t.router({
  addEntry: t.procedure
    .input(z.object({ raw_text: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      return ctx.service.createEntry(input);
    }),

  getEntry: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) => {
      return ctx.service.getEntry(input.id);
    }),

  listEntries: t.procedure
    .input(
      z
        .object({
          type: entryTypeEnum.optional(),
          status: taskStatusEnum.optional(),
          tag: z.string().optional(),
          query: z.string().optional(),
          processed: z.boolean().optional(),
          limit: z.number().int().positive().max(100).optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .optional()
    )
    .query(({ input, ctx }) => {
      return ctx.service.listEntries(input ?? {});
    }),

  getUnprocessed: t.procedure
    .input(z.object({ limit: z.number().int().positive().max(50).optional() }).optional())
    .query(({ input, ctx }) => {
      return ctx.service.getUnprocessed(input?.limit);
    }),

  submitProcessed: t.procedure
    .input(
      z.object({
        id: z.string(),
        type: entryTypeEnum,
        title: z.string().min(1),
        tags: z.array(z.string()),
        priority: z.number().int().min(1).max(5).nullable(),
        due_date: z.string().nullable(),
      })
    )
    .mutation(({ input, ctx }) => {
      return ctx.service.submitProcessed(input);
    }),

  updateEntry: t.procedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.number().int().min(1).max(5).optional(),
        due_date: z.string().nullable().optional(),
        status: taskStatusEnum.optional(),
        type: entryTypeEnum.optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      return ctx.service.updateEntry(input);
    }),

  deleteEntry: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => {
      return ctx.service.deleteEntry(input.id);
    }),

  getTodayTasks: t.procedure
    .input(z.object({ limit: z.number().int().positive().max(10).optional() }).optional())
    .query(({ input, ctx }) => {
      return ctx.service.getTodayTasks(input?.limit);
    }),
});

export type AppRouter = typeof appRouter;
