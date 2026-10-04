// Fails when a tool description stops describing what the endpoint returns.
//
// For an MCP server the description IS the interface. A field the description
// never mentions is a field the model never asks about, so an endpoint can be
// correct, shipped and effectively invisible - which is what happened to ECCTA
// verification on the chain (registrum-mcp#20) and to two terminal reasons
// added by CH-Api#59 and CH-Api#62.
//
// Ground truth is the live openapi.json, the same source check-endpoint-
// coverage.mjs uses. The API's own docstring already lists every terminal
// reason and every verification field, so deriving from it means this package
// never holds a second copy to drift.
//
// Run: node scripts/check-description-drift.mjs [--json]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPENAPI_URL = "https://api.registrum.co.uk/openapi.json";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Terminal reasons the API documents, read from its psc/chain description.
 *
 * Matches the bullet list only (a leading "- `name`"), not every backtick in
 * the prose, so a mention of `registry_number` in an explanation is not
 * mistaken for a terminal reason.
 *
 * @param {string} description @returns {string[]}
 */
export function terminalReasonsFrom(description) {
  return [...(description ?? "").matchAll(/^\s*-\s+`([a-z_]+)`/gm)]
    .map((m) => m[1])
    .filter((r) => r.endsWith("_person") || KNOWN_REASON_SHAPES.has(r));
}

/** Terminal reasons whose names do not end in `_person`. Kept as a shape hint
 * rather than a source of truth: the list above still comes from the API. */
const KNOWN_REASON_SHAPES = new Set([
  "foreign_entity", "unverified_registry", "super_secure", "unknown_kind",
  "depth_limit", "not_found", "cycle_detected", "psc_exempt",
]);

/** The description string a tool is registered with, with its concatenation
 * collapsed. Returns "" when the tool is not registered.
 *
 * @param {string} serverSrc @param {string} toolName @returns {string}
 */
export function toolDescriptionFor(rawSrc, toolName) {
  // A Windows checkout (core.autocrlf) has CRLF line ends, which defeats the newline match below.
  const serverSrc = (rawSrc ?? "").replace(/\r\n/g, "\n");
  const start = serverSrc.indexOf(`registerTool(\n    "${toolName}"`);
  if (start === -1) return "";
  const block = serverSrc.slice(start, serverSrc.indexOf("inputSchema", start));
  const desc = block.indexOf("description:");
  if (desc === -1) return "";
  // These descriptions are plain prose with no embedded quotes, so a simple
  // non-greedy literal match is enough and avoids an escape-handling regex.
  return [...block.slice(desc).matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
}

/** Which of `terms` the description does not mention.
 * @param {string[]} terms @param {string} description @returns {string[]}
 */
export function findMissing(terms, description) {
  const d = (description ?? "").toLowerCase();
  return terms.filter((t) => !d.includes(t.toLowerCase()));
}

/** @returns {Promise<{reasons: string[], chainDescription: string}>} */
export async function fetchApiTruth(url = OPENAPI_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`openapi.json ${res.status}`);
  const doc = await res.json();
  const chainDescription =
    doc.paths?.["/v1/company/{company_number}/psc/chain"]?.get?.description ?? "";
  return { reasons: terminalReasonsFrom(chainDescription), chainDescription };
}

async function main() {
  const src = readFileSync(path.join(__dirname, "..", "src", "server.ts"), "utf8");
  const { reasons } = await fetchApiTruth();
  const missing = findMissing(reasons, toolDescriptionFor(src, "get_psc_chain"));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ reasons, missing }, null, 2));
  } else if (missing.length) {
    console.error(`get_psc_chain omits terminal reasons: ${missing.join(", ")}`);
  } else {
    console.log(`get_psc_chain describes all ${reasons.length} terminal reasons`);
  }
  // exitCode rather than process.exit: exiting with the fetch handle still
  // open trips a libuv assertion on Windows and buries the report.
  process.exitCode = missing.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
