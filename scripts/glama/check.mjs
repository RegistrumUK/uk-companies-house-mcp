// Read-only Glama drift check. No login, no browser - safe to run in CI/schedules.
//
// Why this exists: punkpeye/awesome-mcp-servers#13051 got an automated
// "glama-check" bot comment that turned out to already be satisfied (the
// score badge was already in our README), but investigating it surfaced a
// real, separate problem: Glama's own scan of our server was stale (v1.0.2,
// 5 tools) against what actually ships (v2.0.5, 8 tools) - registrum-landscape
// market-competitors.md, 2026-08-28. This script makes that comparison
// mechanical instead of something a human re-discovers by reading a web page.
//
// Glama's `/api/mcp/v1/servers/...` endpoint requires an API key (another
// account signup Eugene would have to do), so this reads the public HTML
// pages instead - no auth needed, same information a browser sees logged out.
//
// Run: node scripts/glama/check.mjs [--json]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const GLAMA_SCHEMA_URL = "https://glama.ai/mcp/servers/vdmeu/registrum-mcp/schema";
const GLAMA_SCORE_URL = "https://glama.ai/mcp/servers/vdmeu/registrum-mcp/score";

/** @param {string} serverSrc @returns {string[]} registered tool names, sorted */
export function registeredTools(serverSrc) {
  return [...serverSrc.matchAll(/registerTool\(\s*\n?\s*["']([a-z_]+)["']/g)].map((m) => m[1]).sort();
}

/** Tool names Glama's schema page actually lists as `/tools/<name>` links. */
export function toolsFromSchemaHtml(html) {
  return [...new Set([...html.matchAll(/\/tools\/([a-z_]+)/g)].map((m) => m[1]))].sort();
}

/** The version Glama's score page reports as "Latest release: vX.Y.Z". */
export function versionFromScoreHtml(html) {
  const m = html.match(/Latest release:\s*v(?:<!--\s*-->)?([0-9]+\.[0-9]+\.[0-9]+)/);
  return m ? m[1] : null;
}

/**
 * A version we could not read is unverified, not a match: when Glama dropped
 * the "Latest release" line (2026-10) this reported "OK ... (vunknown)" while
 * Glama had last inspected v2.0.7 against a live v2.0.10.
 * @param {string | null} glamaVersion @param {string} liveVersion
 */
export function assessVersion(glamaVersion, liveVersion) {
  if (glamaVersion === null) return { versionDrift: false, unverified: true };
  return { versionDrift: glamaVersion !== liveVersion, unverified: false };
}

/**
 * @param {string[]} liveTools
 * @param {string[]} scannedTools
 */
export function findDrift(liveTools, scannedTools) {
  const missing = liveTools.filter((t) => !scannedTools.includes(t));
  const extra = scannedTools.filter((t) => !liveTools.includes(t));
  return { missing, extra };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (registrum-glama-check)" } });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status} ${res.statusText}`);
  return res.text();
}

async function main() {
  const asJson = process.argv.includes("--json");

  const serverSrc = readFileSync(path.join(root, "src", "server.ts"), "utf-8");
  const liveTools = registeredTools(serverSrc);
  const livePkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));

  const [schemaHtml, scoreHtml] = await Promise.all([fetchText(GLAMA_SCHEMA_URL), fetchText(GLAMA_SCORE_URL)]);
  const scannedTools = toolsFromSchemaHtml(schemaHtml);
  const glamaVersion = versionFromScoreHtml(scoreHtml);

  const { missing, extra } = findDrift(liveTools, scannedTools);
  const { versionDrift, unverified } = assessVersion(glamaVersion, livePkg.version);

  const report = {
    liveVersion: livePkg.version,
    glamaScannedVersion: glamaVersion ?? "unknown",
    versionDrift,
    versionUnverified: unverified,
    liveTools,
    glamaScannedTools: scannedTools,
    toolsMissingFromGlamaScan: missing,
    toolsGlamaHasButWeDoNot: extra,
    driftDetected: Boolean(versionDrift || missing.length || extra.length),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (unverified) {
    console.log(
      `UNVERIFIED: could not read Glama's scanned version from ${GLAMA_SCORE_URL} - its layout changed. ` +
        `Check https://glama.ai/mcp/servers/vdmeu/registrum-mcp by hand against live v${report.liveVersion}, ` +
        `then fix versionFromScoreHtml.`
    );
  } else if (report.driftDetected) {
    console.log(
      `DRIFT: Glama last scanned v${report.glamaScannedVersion} (${scannedTools.length} tools); ` +
        `live is v${report.liveVersion} (${liveTools.length} tools).`
    );
    if (missing.length) console.log(`  Tools Glama has NOT scanned yet: ${missing.join(", ")}`);
    if (extra.length) console.log(`  Tools Glama has that we don't (stale/removed?): ${extra.join(", ")}`);
    console.log(`  Fix: node scripts/glama/sync.mjs (needs a one-time login first: node scripts/glama/login.mjs)`);
  } else {
    console.log(`OK: Glama's scan (v${report.glamaScannedVersion}) matches live (v${report.liveVersion}).`);
  }

  if (report.driftDetected || unverified) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(2);
  });
}
