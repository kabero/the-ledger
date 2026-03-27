import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const RESULTS_DIR = path.join(os.homedir(), ".theledger", "results");

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

app.get("/results/:filename", (c) => {
  const filename = c.req.param("filename");
  // Path traversal protection
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return c.json({ error: "Invalid filename" }, 400);
  }
  const filePath = path.join(RESULTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }
  const ext = path.extname(filename).slice(1).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  c.header("Content-Type", contentType);
  c.header("Content-Disposition", "inline");
  return c.body(data);
});

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
  return svc.createEntryWithImage(imageData, normalizedExt, { raw_text: rawText });
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
