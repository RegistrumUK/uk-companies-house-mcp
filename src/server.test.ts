import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { callApi, createServer, API_BASE } from "./server.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

async function makeClient() {
  const server = createServer("reg_test_key", API_BASE);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

// ─── callApi ─────────────────────────────────────────────────────────────────

describe("callApi", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("makes a GET request with X-API-Key header and returns parsed JSON", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "Tesco PLC" }),
    } as Response);

    const result = await callApi("/company/00445790", "reg_test_key");

    expect(result).toEqual({ name: "Tesco PLC" });
    expect(spy).toHaveBeenCalledWith(
      `${API_BASE}/company/00445790`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "reg_test_key" }),
      })
    );
  });

  it("identifies itself with a versioned User-Agent so usage is attributable", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    await callApi("/company/00445790", "reg_test_key");

    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^@registrum\/mcp\/\d+\.\d+\.\d+/);
  });

  it("throws an error with status code when response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    } as Response);

    await expect(callApi("/company/00445790", "bad_key")).rejects.toThrow(
      "API error 401: Unauthorized"
    );
  });

  it("throws an error with 404 status for unknown company", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    } as Response);

    await expect(callApi("/company/99999999", "reg_test_key")).rejects.toThrow(
      "API error 404"
    );
  });
});

// ─── search_company ───────────────────────────────────────────────────────────

describe("search_company tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns company list from the API", async () => {
    const payload = { results: [{ company_number: "00445790", name: "Tesco PLC" }] };
    mockFetch(200, payload);

    const client = await makeClient();
    const result = await client.callTool({ name: "search_company", arguments: { query: "Tesco" } });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual(payload);
  });

  it("sends limit as items_per_page, the param the API actually declares", async () => {
    // The API route (routes_search.py) declares `items_per_page`, not `limit`.
    // FastAPI silently drops unknown query params, so a `limit=5` here was a
    // no-op and every search silently fell back to the API's default of 20
    // (vdmeu/registrum-mcp#5).
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    } as Response);

    const client = await makeClient();
    await client.callTool({ name: "search_company", arguments: { query: "Tesco", limit: 5 } });

    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain("q=Tesco");
    expect(url).toContain("items_per_page=5");
    expect(url).not.toContain("limit=5");
  });

  it("returns isError on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Too Many Requests"),
    } as Response);

    const client = await makeClient();
    const result = await client.callTool({ name: "search_company", arguments: { query: "Tesco" } });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("429");
  });
});

// ─── get_company ──────────────────────────────────────────────────────────────

describe("get_company tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches /company/{number} and returns the profile", async () => {
    const payload = { company_number: "00445790", name: "Tesco PLC" };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response);

    const client = await makeClient();
    const result = await client.callTool({
      name: "get_company",
      arguments: { company_number: "00445790" },
    });

    expect(result.isError).toBeFalsy();
    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/00445790`);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual(payload);
  });

  it("returns isError on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    } as Response);

    const client = await makeClient();
    const result = await client.callTool({
      name: "get_company",
      arguments: { company_number: "99999999" },
    });

    expect(result.isError).toBe(true);
  });
});

// ─── get_financials ───────────────────────────────────────────────────────────

describe("get_financials tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches /company/{number}/financials", async () => {
    const payload = { revenue: 65000000 };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response);

    const client = await makeClient();
    await client.callTool({
      name: "get_financials",
      arguments: { company_number: "00445790" },
    });

    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/00445790/financials`);
  });
});

// ─── get_directors ────────────────────────────────────────────────────────────

describe("get_directors tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches /company/{number}/directors", async () => {
    const payload = { directors: [] };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response);

    const client = await makeClient();
    await client.callTool({
      name: "get_directors",
      arguments: { company_number: "00445790" },
    });

    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/00445790/directors`);
  });

  /**
   * The tool description is the only thing the calling model reads before it
   * summarises the payload, so a wrong description is a wrong answer to the
   * user. /directors returns the whole officer register - secretaries,
   * corporate secretaries and LLP members included, flagged by officer_role and
   * is_board_director - and the description used to promise "other companies
   * they serve or have served as director", teaching the model the same
   * every-officer-is-a-director mislabel CH-Api#55 fixed on the API side
   * (vdmeu/registrum-mcp#16).
   */
  it("describes the payload as officer roles, not all directors", async () => {
    const client = await makeClient();
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === "get_directors")!.description!;

    expect(description).toContain("officer_role");
    expect(description).toMatch(/secretar/i);
    expect(
      description,
      "the description must not promise that every entry serves as a director"
    ).not.toMatch(/\bas (a |an )?director\b/i);
  });
});

// ─── get_psc ─────────────────────────────────────────────────────────────────

describe("get_psc tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches /company/{number}/psc", async () => {
    const payload = { active_pscs: [], ceased_pscs: [], has_psc_exemption: false };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response);

    const client = await makeClient();
    const result = await client.callTool({
      name: "get_psc",
      arguments: { company_number: "00445790" },
    });

    expect(result.isError).toBeFalsy();
    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/00445790/psc`);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual(payload);
  });

  it("returns isError on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    } as Response);

    const client = await makeClient();
    const result = await client.callTool({
      name: "get_psc",
      arguments: { company_number: "99999999" },
    });

    expect(result.isError).toBe(true);
  });
});

// ─── get_psc_chain ────────────────────────────────────────────────────────────

describe("get_psc_chain tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches /company/{number}/psc/chain without max_depth by default", async () => {
    const payload = { company_number: "12345678", pscs: [], chain_metadata: { companies_resolved: 1 } };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response);

    const client = await makeClient();
    const result = await client.callTool({
      name: "get_psc_chain",
      arguments: { company_number: "12345678" },
    });

    expect(result.isError).toBeFalsy();
    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/12345678/psc/chain`);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual(payload);
  });

  it("appends ?max_depth=3 when max_depth is provided", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ pscs: [] }),
    } as Response);

    const client = await makeClient();
    await client.callTool({
      name: "get_psc_chain",
      arguments: { company_number: "12345678", max_depth: 3 },
    });

    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/12345678/psc/chain?max_depth=3`);
  });

  it("returns isError on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    } as Response);

    const client = await makeClient();
    const result = await client.callTool({
      name: "get_psc_chain",
      arguments: { company_number: "99999999" },
    });

    expect(result.isError).toBe(true);
  });
});

// ─── get_network ──────────────────────────────────────────────────────────────

describe("get_network tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches /company/{number}/network without depth param by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ nodes: [] }),
    } as Response);

    const client = await makeClient();
    await client.callTool({
      name: "get_network",
      arguments: { company_number: "00445790" },
    });

    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/00445790/network`);
  });

  it("appends ?depth=2 when depth is provided", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ nodes: [] }),
    } as Response);

    const client = await makeClient();
    await client.callTool({
      name: "get_network",
      arguments: { company_number: "00445790", depth: 2 },
    });

    const url = (spy.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`${API_BASE}/company/00445790/network?depth=2`);
  });
});

import { TRIAL_DAYS as TRIAL_DAYS_FOR_MSG } from "./trial.js";
describe("callApi without a key", () => {
  it("names the keyless endpoint and the trial", async () => {
    const { callApi } = await import("./server.js");
    const err = await callApi("/x", "").catch((e: Error) => e);
    expect((err as Error).message).toContain("https://registrum.co.uk/api/mcp");
    expect((err as Error).message).toContain(`${TRIAL_DAYS_FOR_MSG} days`);
  });
});
