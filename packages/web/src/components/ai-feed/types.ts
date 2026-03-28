import type { AppRouter } from "@theledger/api";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutput = inferRouterOutputs<AppRouter>;
export type EntryItem = RouterOutput["listEntries"][number];
