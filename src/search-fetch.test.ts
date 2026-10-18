import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { registerTools, createServer, API_BASE, TOOL_NAMES, SERVER_INSTRUCTIONS } from "./server.js";
import { toolDescriptionFor } from "../scripts/check-description-drift.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `search` and `fetch` exist for ChatGPT connectors and deep research, which
 * accept only servers exposing exactly these two tools with OpenAI's contract
 * (https://developers.openai.com/api/docs/mcp, fetched 2026-10-18):
 * search -> { results: [{ id, title, url }] }, fetch -> { id, title, text, url, metadata },
 * each as a JSON string in content[0].text. ChatGPT only cites when url is non-empty.
 */
function mockFetchOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

async function clientFor(quota?: (tool: any) => Promise<string | null>) {
  const server = registerTools(new McpServer({ name: "t", version: "1.0.0" }), {
    apiKey: "reg_test_key",
    baseUrl: API_BASE,
    quota,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(ct);
  return client;
}

const searchBody = {
  status: "ok",
  data: {
    query: "tesco",
    total_results: 2,
    items_per_page: 10,
    start_index: 0,
    items: [
      { company_number: "00445790", company_name: "TESCO PLC", company_status: "active", company_type: "plc", snippet: "x" },
      { company_number: "SC123456", company_name: "TESCO SCOTLAND LTD", company_status: "dissolved", company_type: "ltd", snippet: "y" },
    ],
  },
};

const profileBody = {
  status: "ok",
  data: { company_name: "TESCO PLC", company_number: "00445790", company_status: "active", company_type: "plc" },
  summary_md: "TESCO PLC is an active public limited company.",
};

const parsed = (res: any) => JSON.parse(res.content[0].text);

beforeEach(() => vi.restoreAllMocks());

describe("search tool", () => {
  it("is registered and in TOOL_NAMES", () => {
    expect(TOOL_NAMES).toContain("search");
    expect(TOOL_NAMES).toContain("fetch");
  });

  it("calls /search with q and items_per_page=10", async () => {
    const spy = mockFetchOk(searchBody);
    const client = await clientFor();
    await client.callTool({ name: "search", arguments: { query: "tesco plc" } });
    expect(spy.mock.calls[0][0]).toBe(`${API_BASE}/search?q=tesco+plc&items_per_page=10`);
  });

  it("returns { results: [{id,title,url}] } as structuredContent and as JSON text", async () => {
    mockFetchOk(searchBody);
    const client = await clientFor();
    const res: any = await client.callTool({ name: "search", arguments: { query: "tesco" } });
    const expected = {
      results: [
        { id: "company:00445790", title: "TESCO PLC (00445790, active)", url: "https://registrum.co.uk/company/00445790" },
        { id: "company:SC123456", title: "TESCO SCOTLAND LTD (SC123456, dissolved)", url: "https://registrum.co.uk/company/SC123456" },
      ],
    };
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual(expected);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(parsed(res)).toEqual(expected);
  });

  it("returns an empty results array, not an error, when nothing matches", async () => {
    mockFetchOk({ status: "ok", data: { items: [] } });
    const client = await clientFor();
    const res: any = await client.callTool({ name: "search", arguments: { query: "zzzz" } });
    expect(res.isError).toBeFalsy();
    expect(parsed(res)).toEqual({ results: [] });
  });

  it("rejects an empty query before calling the API", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const client = await clientFor();
    const res: any = await client.callTool({ name: "search", arguments: { query: "" } });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("fetch tool", () => {
  it("fetches the profile endpoint (not the rate-limited bundle) and builds the document", async () => {
    const spy = mockFetchOk(profileBody);
    const client = await clientFor();
    const res: any = await client.callTool({ name: "fetch", arguments: { id: "company:00445790" } });
    expect(spy.mock.calls[0][0]).toBe(`${API_BASE}/company/00445790`);
    const doc = parsed(res);
    expect(res.structuredContent).toEqual(doc);
    expect(doc.id).toBe("company:00445790");
    expect(doc.title).toBe("TESCO PLC");
    expect(doc.url).toBe("https://registrum.co.uk/company/00445790");
    expect(doc.text.startsWith("TESCO PLC is an active public limited company.\n\n{")).toBe(true);
    expect(JSON.parse(doc.text.split("\n\n").slice(1).join("\n\n"))).toEqual(profileBody.data);
    expect(doc.metadata).toEqual({
      company_number: "00445790",
      company_status: "active",
      company_type: "plc",
      source: "Companies House via Registrum",
    });
  });

  it("uses only the JSON when there is no summary_md", async () => {
    mockFetchOk({ status: "ok", data: profileBody.data });
    const client = await clientFor();
    const doc = parsed(await client.callTool({ name: "fetch", arguments: { id: "company:00445790" } }));
    expect(JSON.parse(doc.text)).toEqual(profileBody.data);
  });

  it("accepts a bare number, pads numerics, uppercases and strips whitespace", async () => {
    const spy = mockFetchOk(profileBody);
    const client = await clientFor();
    await client.callTool({ name: "fetch", arguments: { id: " 445790 " } });
    expect(spy.mock.calls[0][0]).toBe(`${API_BASE}/company/00445790`);
    const spy2 = mockFetchOk(profileBody);
    await client.callTool({ name: "fetch", arguments: { id: "company: sc123456" } });
    expect(spy2.mock.calls[1][0]).toBe(`${API_BASE}/company/SC123456`);
  });

  it.each(["officer:123", "company:", "company:TOOLONG123", "bad id!", ""])(
    "rejects %j without calling the API, naming the accepted form",
    async (id) => {
      const spy = vi.spyOn(globalThis, "fetch");
      const client = await clientFor();
      const res: any = await client.callTool({ name: "fetch", arguments: { id } });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("company:<number>");
      expect(spy).not.toHaveBeenCalled();
    }
  );
});

describe("quota gate", () => {
  it("is applied to search and fetch before the API, and a denial is plain text", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const seen: string[] = [];
    const client = await clientFor(async (t) => {
      seen.push(t);
      return "daily cap reached";
    });
    const a: any = await client.callTool({ name: "search", arguments: { query: "tesco" } });
    const b: any = await client.callTool({ name: "fetch", arguments: { id: "company:00445790" } });
    expect(seen).toEqual(["search", "fetch"]);
    expect(a.isError).toBe(true);
    expect(a.content[0].text).toBe("daily cap reached");
    expect(b.content[0].text).toBe("daily cap reached");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("descriptions and instructions", () => {
  const src = readFileSync(join(__dirname, "server.ts"), "utf8");
  it("describe what is returned", () => {
    const s = toolDescriptionFor(src, "search");
    const f = toolDescriptionFor(src, "fetch");
    expect(s).toMatch(/company:/);
    expect(s).toMatch(/results/);
    expect(f).toMatch(/company:/);
    expect(f).toMatch(/metadata/);
  });
  it("instructions mention search then fetch", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/`search` then `fetch`/);
  });
  it("createServer exposes both", async () => {
    const server = createServer("k");
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "c", version: "1" });
    await client.connect(ct);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search", "fetch"]));
  });
});
