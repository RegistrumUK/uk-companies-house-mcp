import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * One-click install badges must keep targeting the hosted endpoint. The payload
 * is URL-encoded (VS Code) or base64 (Cursor), so a typo is invisible to the eye.
 */
const HOSTED = "https://registrum.co.uk/api/mcp";
const readme = readFileSync(path.resolve(__dirname, "..", "README.md"), "utf-8");
const links = [...readme.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => new URL(m[1]));

const find = (host: string, p: string) => links.find((u) => u.hostname === host && u.pathname === p);

describe("README one-click install badges", () => {
  for (const host of ["vscode.dev", "insiders.vscode.dev"]) {
    it(`${host} badge installs the hosted endpoint`, () => {
      const u = find(host, "/redirect/mcp/install");
      expect(u, `no ${host} install badge in README`).toBeDefined();
      expect(u!.searchParams.get("name")).toBeTruthy();
      expect(JSON.parse(u!.searchParams.get("config")!)).toEqual({ type: "http", url: HOSTED });
    });
  }

  it("Cursor badge installs the hosted endpoint", () => {
    const u = find("cursor.com", "/en/install-mcp");
    expect(u, "no Cursor install badge in README").toBeDefined();
    expect(u!.searchParams.get("name")).toBeTruthy();
    const decoded = Buffer.from(u!.searchParams.get("config")!, "base64").toString("utf-8");
    expect(JSON.parse(decoded)).toEqual({ url: HOSTED });
  });

  it("Smithery badge points at registrum/uk-companies-house", () => {
    expect(readme).toContain("https://smithery.ai/server/registrum/uk-companies-house");
  });

  it("the copyable JSON config is still there", () => {
    expect(readme).toMatch(/"mcpServers"[\s\S]*"url": "https:\/\/registrum\.co\.uk\/api\/mcp"/);
  });
});
