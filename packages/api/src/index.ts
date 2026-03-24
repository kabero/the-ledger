import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { createDatabase, EntryRepository, EntryService } from "@theledger/core";
import { appRouter } from "./router.js";
import type { Context } from "./router.js";

const db = createDatabase();
const repository = new EntryRepository(db);
const service = new EntryService(repository);

const app = new Hono();

app.use("/*", cors());

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (): Context => ({ service }),
  })
);

app.get("/health", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
  console.log(`The Ledger API running on http://0.0.0.0:${port}`);
});

export { appRouter, type AppRouter } from "./router.js";
