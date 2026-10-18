import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registeredTools, toolsFromSchemaHtml, versionFromScoreHtml, findDrift, assessVersion, driftFails } from "../scripts/glama/check.mjs";

describe("glama drift checker", () => {
  it("reads registered tool names from server source", () => {
    const src = `server.registerTool(\n "get_psc",\n{});server.registerTool("get_compliance", {});`;
    expect(registeredTools(src)).toEqual(["get_compliance", "get_psc"]);
  });

  it("extracts tool names Glama's schema page actually links to", () => {
    const html = `<a href="/mcp/servers/vdmeu/registrum-mcp/tools/get_company">get_company</a>
      <a href="/mcp/servers/vdmeu/registrum-mcp/tools/get_directors">get_directors</a>`;
    expect(toolsFromSchemaHtml(html)).toEqual(["get_company", "get_directors"]);
  });

  it("dedupes repeated tool links on the schema page", () => {
    const html = `<a href="/tools/get_company">x</a><a href="/tools/get_company">y</a>`;
    expect(toolsFromSchemaHtml(html)).toEqual(["get_company"]);
  });

  it("reads the version off the score page's 'Latest release' text", () => {
    const html = `<div class="woN leflXI"><p>Latest release: v<!-- -->1.0.2</p></div>`;
    expect(versionFromScoreHtml(html)).toBe("1.0.2");
  });

  it("reads the version from the embedded latestRelease data when the visible line is gone (2026-10 layout)", () => {
    // Captured from glama.ai/mcp/servers/RegistrumUK/uk-companies-house-mcp on 2026-10-11.
    // The timeline's "<code>v2.0.7</code>" entries list only versions that CHANGED tools, so
    // they are not the version Glama last synced - this record is.
    const html = String.raw`inspectable\",\"latestRelease\",{\"_1675\":1676},{\"_177\":593,\"_594\":595},{\"_177\":1673,\"_591\":1674},\"@registrum/mcp\",407,\"version\",\"2.0.12\",\"maintainers\",[1679],\"vdmeu\",\"d`;
    const timeline = `update<code class="czikZZ fNBpxp">v<!-- -->2.0.7</code>`;
    expect(versionFromScoreHtml(timeline + html)).toBe("2.0.12");
  });

  // Captured 2026-10-18 after Glama synced v2.1.0. /score now 302s to the listing page, whose
  // React Router turbo-stream payload dedupes strings: "version" there is a key whose value is
  // a back-reference, so no "version","X.Y.Z" text exists to match. Only decoding finds it.
  it("decodes latestRelease.version from the turbo-stream payload when it is a back-reference", () => {
    const html = readFileSync(join(__dirname, "fixtures", "glama-listing-2026-10-18.html"), "utf8");
    expect(html).not.toMatch(/\\"version\\",\\"2\.1\.0/);
    expect(versionFromScoreHtml(html)).toBe("2.1.0");
  });

  it("decodes latestRelease.version from the schema page payload too", () => {
    const html = readFileSync(join(__dirname, "fixtures", "glama-schema-2026-10-18.html"), "utf8");
    expect(versionFromScoreHtml(html)).toBe("2.1.0");
  });

  it("returns null when the score page has no release line (layout changed)", () => {
    expect(versionFromScoreHtml("<div>no release info here</div>")).toBeNull();
  });

  it("flags tools we ship that Glama has not scanned yet", () => {
    const live = ["get_company", "get_compliance", "get_psc"];
    const scanned = ["get_company"];
    expect(findDrift(live, scanned)).toEqual({ missing: ["get_compliance", "get_psc"], extra: [] });
  });

  it("flags tools Glama has that we no longer ship", () => {
    const live = ["get_company"];
    const scanned = ["get_company", "get_removed_tool"];
    expect(findDrift(live, scanned)).toEqual({ missing: [], extra: ["get_removed_tool"] });
  });

  it("passes when scanned and live tool sets match", () => {
    const tools = ["get_company", "get_directors"];
    expect(findDrift(tools, tools)).toEqual({ missing: [], extra: [] });
  });

  // 2026-10-05: Glama dropped the "Latest release" line, the parser returned
  // null, and the checker printed "OK: Glama's scan (vunknown) matches live
  // (v2.0.10)" while Glama's own page showed it had last inspected v2.0.7.
  // A version we could not read is not a version that matches.
  it("treats an unreadable Glama version as unverified, never as a match", () => {
    expect(assessVersion(null, "2.0.10")).toEqual({ versionDrift: false, unverified: true });
    expect(assessVersion("2.0.7", "2.0.10")).toEqual({ versionDrift: true, unverified: false });
    expect(assessVersion("2.0.10", "2.0.10")).toEqual({ versionDrift: false, unverified: false });
  });

  // A copy-only patch (2.1.0 -> 2.1.1, 2026-10-18) left Glama one patch behind with identical
  // tools, and turned every PR's drift check red until Glama rescanned. A check that is red for a
  // harmless reason stops being read, so a patch-only gap with matching tools warns instead.
  it("fails on tool drift or a minor/major gap, but not on a patch-only gap with matching tools", () => {
    expect(driftFails("2.1.0", "2.1.1", [], [])).toBe(false);
    expect(driftFails("2.0.15", "2.1.1", [], [])).toBe(true);
    expect(driftFails("1.9.0", "2.0.0", [], [])).toBe(true);
    expect(driftFails("2.1.0", "2.1.1", ["search"], [])).toBe(true);
    expect(driftFails("2.1.1", "2.1.1", [], ["old_tool"])).toBe(true);
    expect(driftFails("2.1.1", "2.1.1", [], [])).toBe(false);
  });
});
