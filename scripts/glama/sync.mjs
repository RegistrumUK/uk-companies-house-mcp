// Uses the session saved by login.mjs to claim (if needed) and re-sync the
// Glama listing, so a stale scan (registrum-landscape market-competitors.md,
// 2026-08-28: Glama read v1.0.2/5 tools against a live v2.0.5/8 tools) can be
// fixed by running one command instead of clicking through glama.ai by hand
// every time the server ships new tools.
//
// Requires: node scripts/glama/login.mjs (once, or whenever the session expires)
// Run:      node scripts/glama/sync.mjs [--headless]
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { STATE_FILE } from "./login.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERVIEW_URL = "https://glama.ai/mcp/servers/vdmeu/registrum-mcp";
// Verified 2026-08-28, logged in: "Sync Server" lives under the Repository
// tab specifically, not the bare /admin root (which defaults to /profile
// and has no sync control at all - /admin/analytics and /admin/dockerfile
// don't either).
const ADMIN_URL = "https://glama.ai/mcp/servers/vdmeu/registrum-mcp/admin/repository";

/**
 * Work out WHY the sync button is missing, from the page we actually landed on.
 *
 * This used to report both possible causes at once and leave the reader to open
 * a screenshot and decide. On 2026-08-31 the page was a plain sign-in wall and
 * the script said "either the session expired or Glama changed the admin UI" -
 * a diagnostic that has to be re-diagnosed by hand, which is the manual
 * walkthrough this tooling exists to remove.
 *
 * The sign-in signals are deliberately narrow: a redirect to a sign-in URL, or
 * Glama's own wall banner. Matching a bare "sign in" anywhere would make every
 * UI change look like an expired session and send the reader to re-login
 * forever.
 */
export function diagnoseMissingSyncButton({ url = "", title = "", bodyText = "" }) {
  const onSignInUrl = /\/(sign-in|signin|login)\b/i.test(url);
  const hasWallBanner = /you need to sign in to access this page/i.test(bodyText);

  if (onSignInUrl || hasWallBanner) {
    return {
      cause: "expired-session",
      message:
        "The saved Glama session has expired - the admin page redirected to the sign-in wall.\n" +
        "  Fix: node scripts/glama/login.mjs   (interactive GitHub sign-in, then re-run sync.mjs)\n" +
        "  Screenshot of what it served: ",
    };
  }

  return {
    cause: "ui-changed",
    message:
      "Reached the admin page while signed in, but no 'Sync Server' control was on it -\n" +
      "  Glama most likely changed the admin UI. Open the screenshot, find the real\n" +
      "  label/selector, and update the candidates in sync.mjs.\n" +
      "  Screenshot: ",
  };
}

/** Try a list of candidate locators in order; return the first that's visible, or null. */
async function firstVisible(page, candidates) {
  for (const locator of candidates) {
    try {
      if (await locator.isVisible({ timeout: 3000 })) return locator;
    } catch {
      // not present - try the next candidate
    }
  }
  return null;
}

async function main() {
  if (!existsSync(STATE_FILE)) {
    console.error(`No saved Glama session at ${STATE_FILE}.`);
    console.error("Run: node scripts/glama/login.mjs   (one-time interactive GitHub sign-in)");
    process.exit(1);
  }

  const headless = process.argv.includes("--headless");
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();

  // Step 1: claim the server if it isn't claimed yet. The overview page shows
  // "Claim" near the top when unclaimed (verified 2026-08-28, logged out) and
  // an admin panel link once it is.
  await page.goto(OVERVIEW_URL, { waitUntil: "networkidle" });

  const claimButton = await firstVisible(page, [
    page.getByRole("button", { name: /^claim$/i }),
    page.getByRole("link", { name: /^claim$/i }),
    page.getByText(/^claim$/i),
  ]);

  if (claimButton) {
    console.log("Found a 'Claim' control - claiming the server...");
    await claimButton.click();
    await page.waitForLoadState("networkidle");
  } else {
    console.log("No 'Claim' control found - assuming already claimed (or the label changed).");
  }

  // Step 2: trigger a manual re-sync from the admin panel.
  await page.goto(ADMIN_URL, { waitUntil: "networkidle" });

  const syncButton = await firstVisible(page, [
    page.getByRole("button", { name: /sync server/i }),
    page.getByRole("button", { name: /^sync$/i }),
    page.getByText(/sync server/i),
  ]);

  if (!syncButton) {
    const screenshotPath = path.join(__dirname, "state", "admin-page-debug.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const { cause, message } = diagnoseMissingSyncButton({
      url: page.url(),
      title: await page.title().catch(() => ""),
      bodyText: await page.locator("body").innerText().catch(() => ""),
    });
    console.error("Could not find a 'Sync Server' button.");
    console.error("  " + message + screenshotPath);
    await browser.close();
    // Distinct codes so a scheduled runner can tell "go and log in" from
    // "a human needs to read a screenshot".
    process.exit(cause === "expired-session" ? 2 : 1);
  }

  console.log("Found 'Sync Server' - clicking...");
  await syncButton.click();
  await page.waitForTimeout(3000);

  await browser.close();
  console.log("Sync triggered. Glama's scan runs asynchronously - re-check in a few minutes with:");
  console.log("  node scripts/glama/check.mjs");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
