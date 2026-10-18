/**
 * The quota seam that makes an anonymous hosted endpoint possible.
 *
 * Why it lives in the package rather than in the website: `createMcpHandler`
 * takes a factory callback, not a server instance, so the hosted endpoint
 * cannot simply wrap `createServer()`. Without an injectable gate the only way
 * to host these tools with caps would be to copy all eight definitions into the
 * website repo - the copy-drifts-from-source failure this codebase has paid for
 * repeatedly (five advertised tools vs eight registered, for five months).
 *
 * Two properties matter and are asserted here:
 *
 *   1. A refused call must NOT reach the API. The whole point is to protect the
 *      shared Companies House budget, which a gate that fires after the fetch
 *      would not do.
 *   2. A refusal comes back as tool *text*, not a thrown error or an HTTP 429.
 *      The calling model reads it and relays the upgrade path in its own words,
 *      which turns the cap into the conversion surface.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import {
  registerTools,
  createServer,
  TOOL_NAMES,
  API_BASE,
  SERVER_INSTRUCTIONS,
  type QuotaCheck,
  type ToolName,
} from "./server.js";

function mockFetchOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

async function clientFor(quota?: QuotaCheck) {
  const server = new McpServer(
    { name: "registrum", version: "test" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );
  registerTools(server, { apiKey: "reg_test_key", baseUrl: API_BASE, quota });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content.map((c) => c.text).join("");
}

beforeEach(() => vi.restoreAllMocks());

describe("TOOL_NAMES", () => {
  it("lists every tool the server actually registers", async () => {
    const client = await clientFor();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("is what createServer exposes too, so stdio and hosted cannot diverge", async () => {
    const server = createServer("reg_test_key", API_BASE);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1.0.0" });
    await client.connect(ct);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });
});

describe("quota gate", () => {
  it("allows the call through when the check returns null", async () => {
    const fetchSpy = mockFetchOk({ company_name: "TESCO PLC" });
    const client = await clientFor(async () => null);

    const res = await client.callTool({
      name: "get_company",
      arguments: { company_number: "00445790" },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(textOf(res)).toContain("TESCO PLC");
    expect(res.isError).toBeFalsy();
  });

  it("refuses the call without touching the API when a message is returned", async () => {
    const fetchSpy = mockFetchOk({ company_name: "TESCO PLC" });
    const client = await clientFor(async () => "You've used your 2 free traces today.");

    const res = await client.callTool({
      name: "get_psc_chain",
      arguments: { company_number: "00445790" },
    });

    expect(
      fetchSpy,
      "the gate must run BEFORE the upstream call - a cap enforced after the fetch " +
        "protects nothing, since the Companies House budget is already spent"
    ).not.toHaveBeenCalled();
    expect(textOf(res)).toBe("You've used your 2 free traces today.");
  });

  it("surfaces the refusal as readable text the model can relay", async () => {
    mockFetchOk({});
    const message =
      "You've used your 2 free ownership-chain traces for today. " +
      "A free Registrum key gives you 50 lookups a month: https://registrum.co.uk/";
    const client = await clientFor(async () => message);

    const res = await client.callTool({
      name: "get_psc_chain",
      arguments: { company_number: "00445790" },
    });

    expect(textOf(res)).toContain("https://registrum.co.uk/");
    expect(textOf(res)).not.toContain("429");
  });

  it("tells the gate which tool is being called, so caps can differ per tool", async () => {
    mockFetchOk({});
    const seen: ToolName[] = [];
    const client = await clientFor(async (tool) => {
      seen.push(tool);
      return null;
    });

    await client.callTool({ name: "search_company", arguments: { query: "tesco" } });
    await client.callTool({
      name: "get_financials",
      arguments: { company_number: "00445790" },
    });
    await client.callTool({
      name: "get_network",
      arguments: { company_number: "00445790" },
    });

    expect(seen).toEqual(["search_company", "get_financials", "get_network"]);
  });

  it("gates every single tool - none may bypass the check", async () => {
    mockFetchOk({});
    const seen: ToolName[] = [];
    const client = await clientFor(async (tool) => {
      seen.push(tool);
      return "denied";
    });

    // Minimal valid arguments for each tool.
    const args: Record<ToolName, Record<string, unknown>> = {
      search_company: { query: "tesco" },
      get_company: { company_number: "00445790" },
      get_financials: { company_number: "00445790" },
      get_directors: { company_number: "00445790" },
      get_compliance: { company_number: "00445790" },
      get_psc: { company_number: "00445790" },
      get_psc_chain: { company_number: "00445790" },
      get_network: { company_number: "00445790" },
      get_bundle: { company_number: "00445790" },
      search: { query: "tesco" },
      fetch: { id: "company:00445790" },
    };

    for (const name of TOOL_NAMES) {
      await client.callTool({ name, arguments: args[name] });
    }

    expect(
      seen.sort(),
      "a tool missing from the gate is an uncapped hole in the anonymous endpoint"
    ).toEqual([...TOOL_NAMES].sort());
  });

  it("applies no gate at all when none is passed (the stdio path is unaffected)", async () => {
    const fetchSpy = mockFetchOk({ company_name: "TESCO PLC" });
    const client = await clientFor(undefined);

    await client.callTool({ name: "get_company", arguments: { company_number: "00445790" } });

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("reports a gate that throws as a tool error rather than hanging the client", async () => {
    mockFetchOk({});
    const client = await clientFor(async () => {
      throw new Error("supabase unreachable");
    });

    const res = await client.callTool({
      name: "get_company",
      arguments: { company_number: "00445790" },
    });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("supabase unreachable");
  });
});
