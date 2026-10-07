import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The registry JWT from `mcp-publisher login github-oidc` lives a few minutes.
// On the 2.0.12 release the npm-propagation wait ran ~20 minutes after a login
// done up front, and publish failed 401 "Registry JWT token expired" (#33).
const WF = readFileSync(join(__dirname, "..", ".github", "workflows", "publish.yml"), "utf8");

function registryStep(): string {
  const start = WF.indexOf("- name: Publish to the MCP registry");
  expect(start).toBeGreaterThan(-1);
  const rest = WF.slice(start);
  const next = rest.indexOf("\n      #", 1);
  // Drop comment lines so prose mentioning the commands cannot satisfy the test.
  return (next === -1 ? rest : rest.slice(0, next))
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

describe("publish.yml registry step", () => {
  it("logs in after the npm propagation wait, fresh inside each publish attempt", () => {
    const step = registryStep();
    const wait = step.indexOf("npm view");
    const publishLoop = step.indexOf("for attempt");
    const login = step.indexOf("mcp-publisher login");
    const publish = step.indexOf("mcp-publisher publish");
    expect(wait).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(wait);
    // login lives inside the retry loop, before the publish it authorises
    expect(login).toBeGreaterThan(publishLoop);
    expect(login).toBeLessThan(publish);
    // and there is no earlier login before the wait
    expect(step.match(/mcp-publisher login github-oidc/g)).toHaveLength(1);
  });
});
