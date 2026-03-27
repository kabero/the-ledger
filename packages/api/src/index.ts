import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  createDatabase,
  type Entry,
  EntryRepository,
  EntryService,
  MAX_IMAGE_SIZE,
} from "@theledger/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "./router.js";
import { appRouter } from "./router.js";

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
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

function validateAndCreateEntryFromImage(
  svc: EntryService,
  rawText: string,
  imageData: Buffer,
  ext: string,
): Entry {
  const normalizedExt = ext.toLowerCase().replace(/^\./, "");
  if (
    !ALLOWED_IMAGE_EXTENSIONS.includes(normalizedExt as (typeof ALLOWED_IMAGE_EXTENSIONS)[number])
  ) {
    throw new Error(`未対応の画像形式: ${normalizedExt}`);
  }
  if (imageData.length > MAX_IMAGE_SIZE) {
    throw new Error("画像サイズが10MBを超えています");
  }
  return svc.createEntryWithImage(rawText, imageData, normalizedExt);
}

app.post("/upload", async (c) => {
  try {
    const body = await c.req.parseBody();
    const rawText = (body.raw_text as string) || "";
    const file = body.image;

    if (!file || !(file instanceof File)) {
      return c.json({ error: "画像ファイルが必要です" }, 400);
    }

    const ext = file.name.split(".").pop() || "png";
    const arrayBuf = await file.arrayBuffer();
    const imageData = Buffer.from(arrayBuf);
    const entry = validateAndCreateEntryFromImage(service, rawText, imageData, ext);
    return c.json(entry);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

// Simple JSON endpoint for iOS Shortcuts (base64 image)
app.post("/api/quick-add", async (c) => {
  try {
    const body = (await c.req.json()) as { raw_text?: string; image?: string; image_ext?: string };
    const rawText = body.raw_text || "";
    const image = body.image;
    const ext = body.image_ext || "png";

    if (image) {
      const imageData = Buffer.from(image, "base64");
      const entry = validateAndCreateEntryFromImage(service, rawText, imageData, ext);
      return c.json({ ok: true, entry });
    }

    if (!rawText) {
      return c.json({ error: "テキストか画像が必要です" }, 400);
    }

    const entry = service.createEntry({ raw_text: rawText });
    return c.json({ ok: true, entry });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
  console.log(`The Ledger API running on http://0.0.0.0:${port}`);
});

export { type AppRouter, appRouter } from "./router.js";
