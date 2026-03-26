import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  createDatabase,
  type Entry,
  EntryRepository,
  EntryService,
  MAX_IMAGE_SIZE,
  ScheduledTaskRepository,
} from "@theledger/core";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "./router.js";
import { appRouter } from "./router.js";

const db = createDatabase();
const repository = new EntryRepository(db);
const scheduledTaskRepository = new ScheduledTaskRepository(db);
const service = new EntryService(repository, scheduledTaskRepository);

const app = new Hono();

// --- CORS: restrict origin when CORS_ORIGIN is set ---
const corsOrigin = process.env.CORS_ORIGIN; // e.g. "http://localhost:5173"
app.use("/*", cors(corsOrigin ? { origin: corsOrigin.split(","), credentials: true } : undefined));

// --- API key authentication middleware ---
const API_KEY = process.env.API_KEY;

const requireApiKey: MiddlewareHandler = async (c, next) => {
  // If API_KEY env is not set, skip auth (local dev)
  if (!API_KEY) {
    await next();
    return;
  }
  const provided =
    c.req.header("x-api-key") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

// --- Simple in-memory rate limiter ---
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 30; // requests per window
const RATE_LIMIT_MAP_MAX = 10_000; // max unique IPs tracked before eviction
// Set TRUST_PROXY=1 when behind a reverse proxy (nginx, cloudflare, etc.)
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const rateLimit: MiddlewareHandler = async (c, next) => {
  // Only trust x-forwarded-for / x-real-ip when behind a trusted proxy
  const ip = TRUST_PROXY
    ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown"
    : "unknown";
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    // Evict oldest entries if map is too large
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      let oldest: string | null = null;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [key, val] of rateLimitMap) {
        if (val.resetAt < oldestTime) {
          oldestTime = val.resetAt;
          oldest = key;
        }
      }
      if (oldest) rateLimitMap.delete(oldest);
    }
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  c.header("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
  c.header("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX - entry.count)));
  if (entry.count > RATE_LIMIT_MAX) {
    return c.json({ error: "Too many requests" }, 429);
  }
  await next();
};

// Periodically clean up expired rate-limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now >= val.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}, 300_000).unref();

app.use("/trpc/*", requireApiKey, rateLimit);
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
  return svc.createEntryWithImage(imageData, normalizedExt, { raw_text: rawText });
}

app.post("/upload", requireApiKey, rateLimit, async (c) => {
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
app.post("/api/quick-add", requireApiKey, rateLimit, async (c) => {
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

// Run due scheduled tasks every 60 seconds
setInterval(() => {
  try {
    service.runDueScheduledTasks();
  } catch (err) {
    console.error("[scheduler] Error running due tasks:", err);
  }
}, 60_000).unref();

// Also run once on startup (after a short delay to let the server settle)
setTimeout(() => {
  try {
    service.runDueScheduledTasks();
  } catch (err) {
    console.error("[scheduler] Error running due tasks on startup:", err);
  }
}, 5_000).unref();

export { type AppRouter, appRouter } from "./router.js";
