import { describe, it, expect } from "vitest";
import { signedInFromPage } from "../scripts/glama/login.mjs";

// 2026-10-05: Glama stopped redirecting to /sign-in and now renders the sign-in
// form on the admin URL itself ("You need to sign in to access this page").
// The URL-only check read that as signed in, saved an empty session (0
// cookies), and sync.mjs then ran logged out and clicked nothing.
describe("glama login: signed-in detection", () => {
  const ADMIN = "https://glama.ai/mcp/servers/vdmeu/registrum-mcp/admin";

  it("treats the sign-in form on the admin URL as signed OUT", () => {
    const text = "You need to sign in to access this page All-in-one AI workspace Sign Up Already have an account?";
    expect(signedInFromPage(ADMIN, text, 0)).toBe(false);
  });

  it("requires a glama.ai cookie even when the page looks fine", () => {
    expect(signedInFromPage(ADMIN, "Repository Sync Server", 0)).toBe(false);
  });

  it("accepts the admin page with a session cookie and no sign-in form", () => {
    expect(signedInFromPage(ADMIN, "Repository Sync Server", 2)).toBe(true);
  });

  it("rejects /sign-in URLs and other hosts", () => {
    expect(signedInFromPage("https://glama.ai/sign-in", "", 2)).toBe(false);
    expect(signedInFromPage("https://github.com/login", "", 2)).toBe(false);
  });
});
