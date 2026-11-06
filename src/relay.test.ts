/**
 * `npx @registrum/mcp` with no key used to be a dead end (#61): every tool call
 * threw "REGISTRUM_API_KEY is not set", while server.json and the directories
 * told people the key was optional. The relay makes that claim true - with no
 * key the stdio process forwards every message to the hosted keyless endpoint,
 * which owns the anonymous caps and the signup nudge.
 *
 * Asserted end to end through a real Client and a real McpServer, with only the
 * two hops replaced by in-memory pairs: what the user's client sees must be
 * exactly what the hosted endpoint serves.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { registerTools, TOOL_NAMES, SERVER_INSTRUCTIONS } from "./server.js";
import { relay } from "./relay.js";

beforeEach(() => vi.restoreAllMocks());

/** user's client <-> [local end | relay | remote end] <-> hosted server */
async function throughRelay(quotaText: string) {
  const hosted = new McpServer(
    { name: "registrum", version: "hosted" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );
  registerTools(hosted, { apiKey: "demo", quota: async () => quotaText });
  const [remoteEnd, hostedEnd] = InMemoryTransport.createLinkedPair();
  await hosted.connect(hostedEnd);

  const [clientEnd, localEnd] = InMemoryTransport.createLinkedPair();
  await relay(localEnd, remoteEnd);

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientEnd);
  return { client, localEnd, remoteEnd };
}

describe("keyless relay", () => {
  it("serves the hosted endpoint's tools and instructions", async () => {
    const { client } = await throughRelay("capped");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it("returns the hosted answer to a tool call, cap refusals included", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { client } = await throughRelay("Daily cap reached - free key at https://registrum.co.uk/?utm_source=mcp");
    const result = await client.callTool({ name: "search_company", arguments: { query: "brewdog" } });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toContain("utm_source=mcp");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers a request with an error when the endpoint is unreachable, rather than hanging", async () => {
    const dead = {
      start: async () => undefined,
      send: async () => {
        throw new Error("ECONNREFUSED");
      },
      close: async () => undefined,
    } as unknown as Parameters<typeof relay>[1];
    const [clientEnd, localEnd] = InMemoryTransport.createLinkedPair();
    await relay(localEnd, dead);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await expect(client.connect(clientEnd)).rejects.toThrow(/unreachable: ECONNREFUSED/);
  });

  it("closes the remote side when the user's client goes away", async () => {
    const { client, remoteEnd } = await throughRelay("capped");
    const closed = vi.fn();
    const prev = remoteEnd.onclose;
    remoteEnd.onclose = () => {
      prev?.();
      closed();
    };
    await client.close();
    expect(closed).toHaveBeenCalled();
  });
});
