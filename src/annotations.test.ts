import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer, API_BASE } from "./server.js";

/**
 * Every tool is a read of public register data, so every tool says so.
 *
 * MCP directories and clients (Glama, Smithery, Claude, ChatGPT) use these
 * hints to decide what needs a confirmation prompt and how to rank a server.
 * The most-used UK Companies House server sets all five on every tool and we set
 * none (RegistrumUK/uk-companies-house-mcp#53).
 *
 * This iterates what the server actually registers rather than a list kept here,
 * so a twelfth tool cannot ship without the full set.
 */
async function listedTools() {
  const server = createServer("reg_test_key", API_BASE);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "annotations-test", version: "1.0.0" });
  await client.connect(ct);
  return (await client.listTools()).tools;
}

describe("tool annotations", () => {
  it("lists tools to iterate (guards the loop below)", async () => {
    expect((await listedTools()).length).toBeGreaterThanOrEqual(11);
  });

  it("every registered tool carries the full read-only annotation set", async () => {
    const problems: string[] = [];
    for (const tool of await listedTools()) {
      const a = tool.annotations;
      if (!a) {
        problems.push(`${tool.name}: no annotations`);
        continue;
      }
      if (typeof a.title !== "string" || !a.title.trim()) problems.push(`${tool.name}: no annotations.title`);
      if (a.readOnlyHint !== true) problems.push(`${tool.name}: readOnlyHint must be true`);
      if (a.destructiveHint !== false) problems.push(`${tool.name}: destructiveHint must be false`);
      if (a.idempotentHint !== true) problems.push(`${tool.name}: idempotentHint must be true`);
      if (a.openWorldHint !== true) problems.push(`${tool.name}: openWorldHint must be true`);
    }
    expect(
      problems,
      "Every tool needs annotations: { title, readOnlyHint: true, destructiveHint: false, " +
        "idempotentHint: true, openWorldHint: true } (use ...toolMeta(title) in server.ts).\n  " +
        problems.join("\n  ")
    ).toEqual([]);
  });

  it("annotation title matches the tool title so clients show one name", async () => {
    for (const tool of await listedTools()) {
      expect(tool.annotations?.title, tool.name).toBe(tool.title);
    }
  });
});
