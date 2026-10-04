import { describe, it, expect } from "vitest";
import { diagnoseMissingSyncButton } from "../scripts/glama/sync.mjs";

/**
 * When sync.mjs cannot find "Sync Server" it used to report two possible
 * causes at once - "either the session expired or Glama changed the UI" -
 * and leave the reader to open a screenshot and decide. On 2026-08-31 the
 * page it had actually landed on was a plain sign-in wall ("You need to sign
 * in to access this page"), which the script could have read directly.
 *
 * A diagnostic that lists both causes is one the next person has to
 * re-diagnose by hand, which is exactly the manual walkthrough this tooling
 * exists to remove. The page itself says which one it is; read it.
 */
describe("diagnoseMissingSyncButton", () => {
  it("names an expired session when Glama serves the sign-in wall", () => {
    const d = diagnoseMissingSyncButton({
      url: "https://glama.ai/mcp/servers/vdmeu/registrum-mcp/admin/repository",
      title: "Sign in",
      bodyText: "You need to sign in to access this page\nAll-in-one AI workspace\nSign Up",
    });
    expect(d.cause).toBe("expired-session");
    expect(d.message).toMatch(/login\.mjs/);
  });

  it("recognises the wall from a redirect to a sign-in URL alone", () => {
    // The banner text is rendered late, so a screenshot taken early can miss
    // it while the URL already gives the answer.
    const d = diagnoseMissingSyncButton({
      url: "https://glama.ai/sign-in?next=%2Fmcp%2Fservers%2Fvdmeu%2Fregistrum-mcp%2Fadmin",
      title: "",
      bodyText: "",
    });
    expect(d.cause).toBe("expired-session");
  });

  it("falls back to a UI change when the page is the real admin page", () => {
    const d = diagnoseMissingSyncButton({
      url: "https://glama.ai/mcp/servers/vdmeu/registrum-mcp/admin/repository",
      title: "Repository - Glama",
      bodyText: "Repository settings\nDockerfile\nAnalytics\nRefresh listing",
    });
    expect(d.cause).toBe("ui-changed");
    expect(d.message).toMatch(/sync\.mjs/);
  });

  it("does not call a logged-in page expired just because 'sign in' appears in a footer link", () => {
    // Guards the guard: matching a bare "sign in" anywhere would make every
    // failure look like an expired session and send the reader to re-login
    // forever.
    const d = diagnoseMissingSyncButton({
      url: "https://glama.ai/mcp/servers/vdmeu/registrum-mcp/admin/repository",
      title: "Repository - Glama",
      bodyText: "Repository settings\nHelp\nSign in to another account\nTerms of Service",
    });
    expect(d.cause).toBe("ui-changed");
  });

  it("always points at the screenshot, whatever the cause", () => {
    for (const bodyText of ["You need to sign in to access this page", "Repository settings"]) {
      const d = diagnoseMissingSyncButton({ url: "https://glama.ai/x", title: "", bodyText });
      expect(d.message).toMatch(/screenshot|\.png/i);
    }
  });
});

describe("sync.mjs as a module", () => {
  it("does not run the browser sync when imported", async () => {
    // An unguarded main() made every import launch the sync, which exits 1 without a
    // Glama session - that failed the v2.0.8 publish run in CI.
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", "await import('./scripts/glama/sync.mjs')"],
      { encoding: "utf8", timeout: 20000, env: { ...process.env, HOME: "/nonexistent", USERPROFILE: "/nonexistent" } },
    );
    expect(res.status, res.stderr).toBe(0);
  });
});
