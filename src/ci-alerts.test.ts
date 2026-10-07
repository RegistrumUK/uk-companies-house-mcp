import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tests used to run only in publish.yml on a tag, so a red master was invisible
// (vdmeu/CH-Api#169, #174). ci.yml must run them and page Telegram when red.
const CI = readFileSync(join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");

describe("ci.yml", () => {
  it("builds and runs npm test on push and pull_request to master", () => {
    expect(CI).toMatch(/run:\s*npm run build\s*$/m);
    expect(CI).toMatch(/run:\s*npm test\s*$/m);
    expect(CI).toMatch(/pull_request:\s*\n\s*branches:\s*\[master\]/);
    expect(CI).toMatch(/push:\s*\n\s*branches:\s*\[master\]/);
  });

  it("alerts Telegram when master is red", () => {
    expect(CI).toContain("failure() && github.ref == 'refs/heads/master'");
    expect(CI).toContain("api.telegram.org");
    expect(CI).toContain("secrets.TELEGRAM_BOT_TOKEN");
    expect(CI).toContain("secrets.TELEGRAM_CRITICAL_CHAT_ID");
  });
});
