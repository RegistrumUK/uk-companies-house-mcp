// One-time interactive login: opens a real (headed) browser window so Eugene
// can sign in to Glama with GitHub once, then saves the session so
// scripts/glama/sync.mjs can act on it later without asking him to click
// through the UI again.
//
// This is the only step that has to be a human: GitHub OAuth requires
// completing 2FA/consent in a real browser, and Glama has no API-key path for
// claiming or re-syncing a server (checked 2026-08-28 - the admin page is a
// plain sign-up wall, and the public API needs its own separate key).
//
// Run: node scripts/glama/login.mjs
// Then: node scripts/glama/sync.mjs
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STATE_DIR = path.join(__dirname, "state");
export const STATE_FILE = path.join(STATE_DIR, "glama-auth.json");

/**
 * Signed in = on glama.ai, off any /sign-in or /sign-up path, the sign-in form
 * NOT on the page, and at least one glama.ai cookie held. Each condition was
 * learned the hard way: the hostname check because GitHub's own login pages
 * passed a path-only test; the page-text and cookie checks because on
 * 2026-10-05 Glama stopped redirecting and began rendering its sign-in form on
 * the admin URL itself - the URL test called that "signed in", saved a
 * 0-cookie session, and sync.mjs then ran logged out.
 * @param {string} url @param {string} bodyText @param {number} glamaCookieCount
 */
export function signedInFromPage(url, bodyText, glamaCookieCount) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.hostname !== "glama.ai") return false;
  if (u.pathname.includes("/sign-in") || u.pathname.includes("/sign-up")) return false;
  if (/you need to sign in|already have an account\?/i.test(bodyText)) return false;
  return glamaCookieCount > 0;
}

async function isPastSignInWall(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const cookies = await page.context().cookies("https://glama.ai").catch(() => []);
  return signedInFromPage(page.url(), bodyText, cookies.length);
}

/**
 * Poll until the page has genuinely settled on glama.ai past the sign-in
 * wall, requiring several consecutive stable reads rather than one lucky
 * moment - a multi-page GitHub sign-in (password, 2FA, device approval,
 * OAuth consent) passes through several transient states before landing.
 */
async function waitForRealSignIn(page, { timeoutMs, pollMs = 2000, requiredStableReads = 3 }) {
  const deadline = Date.now() + timeoutMs;
  let stableCount = 0;
  while (Date.now() < deadline) {
    if (await isPastSignInWall(page)) {
      stableCount += 1;
      if (stableCount >= requiredStableReads) return true;
    } else {
      stableCount = 0;
    }
    await page.waitForTimeout(pollMs);
  }
  return false;
}

async function main() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

  console.log("Opening a browser window. Take your time signing in to Glama with GitHub -");
  console.log("password, 2FA, device approval, OAuth consent, however many pages it takes.");
  console.log("This script polls for real completion; it will not move on early.\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://glama.ai/mcp/servers/vdmeu/registrum-mcp/admin");
  await page.waitForLoadState("networkidle");

  if (await isPastSignInWall(page)) {
    console.log("Already past the sign-in wall - no action needed.");
  } else {
    console.log("Waiting for you to finish signing in (up to 10 minutes, checked every 2s)...");
    const done = await waitForRealSignIn(page, { timeoutMs: 10 * 60 * 1000 });
    if (!done) {
      console.log("Timed out waiting - saving whatever session state exists anyway. Re-run if sync.mjs fails.");
    }
  }

  await context.storageState({ path: STATE_FILE });

  // Closed-loop verification: reload the admin page in a FRESH context
  // using only the just-saved state, the same way sync.mjs will. If that
  // still lands on the sign-in wall, don't claim success.
  const verifyContext = await browser.newContext({ storageState: STATE_FILE });
  const verifyPage = await verifyContext.newPage();
  await verifyPage.goto("https://glama.ai/mcp/servers/vdmeu/registrum-mcp/admin", { waitUntil: "networkidle" });
  const stillWalled = !(await isPastSignInWall(verifyPage));
  await browser.close();

  if (stillWalled) {
    console.error(`\nStill not signed in (saved state lands on ${verifyPage.url()}). Nothing saved that would help.`);
    console.error("Re-run this script and make sure the GitHub sign-in actually completes before the window closes.");
    process.exit(1);
  }

  console.log(`\nVerified: the saved session reaches the admin page without a sign-in wall.`);
  console.log(`Saved to ${STATE_FILE} (gitignored - this is a live login, treat it like a credential).`);
  console.log("Run: node scripts/glama/sync.mjs");
}

// Only run when invoked directly - sync.mjs imports STATE_FILE from this
// module and must not accidentally trigger a second interactive login as a
// side effect of that import (found 2026-08-28: it did exactly that, and
// sync.mjs's own console output got interleaved with a second login.mjs run).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
