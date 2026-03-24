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

app.post("/upload", async (c) => {
  try {
    const body = await c.req.parseBody();
    const rawText = (body["raw_text"] as string) || "";
    const file = body["image"];

    if (!file || !(file instanceof File)) {
      return c.json({ error: "画像ファイルが必要です" }, 400);
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return c.json({ error: "画像サイズが10MBを超えています" }, 400);
    }

    const ext = file.name.split(".").pop() || "png";
    const allowed = ["png", "jpg", "jpeg", "gif", "webp"];
    if (!allowed.includes(ext.toLowerCase())) {
      return c.json({ error: `未対応の画像形式: ${ext}` }, 400);
    }

    const arrayBuf = await file.arrayBuffer();
    const imageData = Buffer.from(arrayBuf);
    const entry = service.createEntryWithImage(rawText, imageData, ext);
    return c.json(entry);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
  console.log(`The Ledger API running on http://0.0.0.0:${port}`);
});

export { appRouter, type AppRouter } from "./router.js";
