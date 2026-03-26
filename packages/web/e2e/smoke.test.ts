import { expect, test } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("app loads and displays correctly", async ({ page }) => {
    await page.goto("/");
    await page.screenshot({ path: "/tmp/theledger-e2e-01-load.png", fullPage: true });

    // Verify title contains "LEDGER"
    const title = await page.title();
    expect(title.toUpperCase()).toContain("LEDGER");

    // Verify the header title is visible
    const headerTitle = page.locator(".header-title");
    await expect(headerTitle).toBeVisible();
    await expect(headerTitle).toContainText("LEDGER");
    await page.screenshot({ path: "/tmp/theledger-e2e-02-header.png", fullPage: true });
  });

  test("tabs are visible and clickable", async ({ page }) => {
    await page.goto("/");

    // Verify tabs are visible
    const tabs = page.locator(".tabs .tab");
    await expect(tabs).toHaveCount(4);

    // Verify tab labels
    await expect(tabs.nth(0)).toContainText("タスク");
    await expect(tabs.nth(1)).toContainText("おつかい");
    await expect(tabs.nth(2)).toContainText("メモ");
    await expect(tabs.nth(3)).toContainText("ほしい");
    await page.screenshot({ path: "/tmp/theledger-e2e-03-tabs.png", fullPage: true });

    // Click each tab and verify it becomes active
    for (let i = 0; i < 4; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/);
    }
    await page.screenshot({ path: "/tmp/theledger-e2e-04-tab-click.png", fullPage: true });
  });

  test("AI Dashboard opens when clicking AI button", async ({ page }) => {
    await page.goto("/");

    // Find and click the AI button
    const aiButton = page.locator(".header-ai-btn");
    await expect(aiButton).toBeVisible();
    await expect(aiButton).toContainText("AI");
    await page.screenshot({ path: "/tmp/theledger-e2e-05-before-ai.png", fullPage: true });

    await aiButton.click();

    // After clicking AI, the AiFeed component should render
    // The app replaces the main view with AiFeed when showAiFeed is true
    // Wait a moment for the view to switch
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/theledger-e2e-06-ai-feed.png", fullPage: true });

    // The tabs should no longer be visible (AiFeed replaces the main view)
    const tabs = page.locator(".tabs .tab");
    await expect(tabs).toHaveCount(0);
  });
});
