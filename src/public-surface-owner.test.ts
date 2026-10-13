import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Discovery surfaces name the RegistrumUK org and the keyless product
 * (refs RegistrumUK/CH-Api#79, RegistrumUK/uk-companies-house-mcp#15).
 *
 * The repo moved from vdmeu/registrum-mcp on 2026-10-08. GitHub redirects the
 * old path, so a stale link breaks nothing visibly and nobody notices: the
 * publish workflow was still pointing at github.com/vdmeu/registrum-mcp after
 * the move. The MCP registry name is also bound to the GitHub owner, so
 * `io.github.vdmeu/...` would address a different (orphaned) entry.
 *
 * Out of scope on purpose: glama.ai/mcp/servers/vdmeu/... URLs (the Glama
 * listing path is not ours to rename) and glama.json maintainers (a user, not
 * a repo path). Bare issue refs like vdmeu/CH-Api#80 are historical pointers.
 */
const root = path.resolve(__dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf-8");

const MOVED = [
  "CH-Api", "registrum-website", "registrum", "registrum-tests", "registrum-mcp",
  "uk-companies-house-mcp", "ch-scout-agent", "registrum-mcp-examples",
  "n8n-nodes-registrum", "companies-house-api-node-starter",
  "companies-house-api-python-starter", "registrum-agent-context", "claude-ch-proj",
];
const STALE = new RegExp(String.raw`(?:github\.com/|io\.github\.|(?<![\w/.])vdmeu/)(?:vdmeu/)?(?:${MOVED.join("|")})(?![\w#-])|io\.github\.vdmeu`, "i");

const liveFiles = (): string[] => {
  const out = ["README.md", "package.json", "server.json", "smithery.yaml", "CLAUDE.md", "SECURITY.md"];
  for (const dir of ["src", "scripts", "scripts/glama", ".github/workflows"]) {
    for (const f of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (!f.isFile() || /\.test\.ts$/.test(f.name)) continue;
      out.push(`${dir}/${f.name}`);
    }
  }
  return out;
};

describe("public surfaces name the RegistrumUK org", () => {
  it("no live file points at the old vdmeu owner", () => {
    const hits: string[] = [];
    for (const f of liveFiles()) {
      read(f).split("\n").forEach((line, i) => {
        if (/glama\.ai\//.test(line)) return;
        // History notes that name the old owner on purpose ("was vdmeu/...").
        if (/(was|old|formerly) vdmeu/i.test(line)) return;
        if (STALE.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(
      hits,
      `Stale vdmeu references. Use RegistrumUK/uk-companies-house-mcp:\n${hits.join("\n")}`
    ).toEqual([]);
  });
});

describe("discovery copy does not revert to the keyed-only product", () => {
  const surfaces = ["README.md", "package.json", "server.json", "smithery.yaml"];
  const KEYED_ONLY = [
    /\bapi key (is )?required\b/i,
    /\brequires? (an? )?(free )?(registrum )?api key\b/i,
    /\byou('ll| will)? need (an? )?(free )?(registrum )?api key\b/i,
    /\bsign ?up (first )?to (use|get started)\b/i,
  ];
  for (const f of surfaces) {
    it(`${f} never says a key is required`, () => {
      const text = read(f);
      const hits = KEYED_ONLY.filter((re) => re.test(text)).map(String);
      expect(
        hits,
        `${f} advertises the pre-keyless product (hosted endpoint needs no key, since 2026-08-07)`
      ).toEqual([]);
    });
  }
});
