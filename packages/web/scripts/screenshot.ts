import { chromium } from "@playwright/test";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args.url ?? "http://localhost:5173";
  const output = args.output ?? "/tmp/theledger-screenshot.png";
  const width = Number.parseInt(args.width ?? "1280", 10);

  const browser = await chromium.launch({ headless: true });

  try {
    // Desktop / custom width screenshot
    const desktopContext = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const desktopPage = await desktopContext.newPage();

    try {
      await desktopPage.goto(url, { waitUntil: "networkidle", timeout: 10_000 });
    } catch (err) {
      if (String(err).includes("ERR_CONNECTION_REFUSED") || String(err).includes("ECONNREFUSED")) {
        console.error(`Could not connect to ${url}. Is the dev server running?`);
        process.exit(1);
      }
      // For other errors (e.g. timeout due to network requests), continue with screenshot
      console.warn(`Warning: page load did not fully complete: ${err}`);
    }

    await desktopPage.screenshot({ path: output, fullPage: true });
    console.log(`Desktop (${width}px) full-page screenshot saved to ${output}`);

    // Viewport-only screenshot
    const viewportOutput = output.replace(/\.png$/, `-viewport-${width}.png`);
    await desktopPage.screenshot({ path: viewportOutput, fullPage: false });
    console.log(`Desktop (${width}px) viewport screenshot saved to ${viewportOutput}`);
    await desktopContext.close();

    // Mobile 375px screenshot
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const mobilePage = await mobileContext.newPage();

    try {
      await mobilePage.goto(url, { waitUntil: "networkidle", timeout: 10_000 });
    } catch {
      console.warn("Warning: mobile page load did not fully complete");
    }

    const mobileOutput = output.replace(/\.png$/, "-mobile-375.png");
    await mobilePage.screenshot({ path: mobileOutput, fullPage: true });
    console.log(`Mobile (375px) full-page screenshot saved to ${mobileOutput}`);

    const mobileViewportOutput = output.replace(/\.png$/, "-viewport-375.png");
    await mobilePage.screenshot({ path: mobileViewportOutput, fullPage: false });
    console.log(`Mobile (375px) viewport screenshot saved to ${mobileViewportOutput}`);
    await mobileContext.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
