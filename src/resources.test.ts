import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import {
  createServer,
  registerTools,
  API_BASE,
  RESOURCE_TOOL,
  type QuotaCheck,
  type ToolName,
} from "./server.js";

/**
 * Resources: company://{number}/profile|financials|psc|compliance
 * (RegistrumUK/uk-companies-house-mcp#53).
 *
 * They return the same JSON the matching tool returns and go through the same
 * quota gate. The hosted endpoint applies keyless daily caps per tool; a
 * resource that skipped the gate would be a free side door around them.
 */
function mockFetchOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

async function connect(server: McpServer) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "resources-test", version: "1.0.0" });
  await client.connect(ct);
  return client;
}

/** The hosted endpoint's shape: its own McpServer plus registerTools with a quota. */
async function hostedClient(quota?: QuotaCheck) {
  const server = new McpServer({ name: "registrum", version: "test" }, { capabilities: { tools: {} } });
  registerTools(server, { apiKey: "reg_test_key", baseUrl: API_BASE, quota });
  return connect(server);
}

const stdioClient = () => connect(createServer("reg_test_key", API_BASE));

beforeEach(() => vi.restoreAllMocks());

describe("resource templates", () => {
  it("createServer declares the resources capability", async () => {
    const client = await stdioClient();
    expect(client.getServerCapabilities()?.resources).toBeDefined();
  });

  it("lists the four company:// templates", async () => {
    const client = await stdioClient();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      "company://{number}/compliance",
      "company://{number}/financials",
      "company://{number}/profile",
      "company://{number}/psc",
    ]);
    for (const t of resourceTemplates) {
      expect(t.mimeType, t.name).toBe("application/json");
      expect(t.description, t.name).toBeTruthy();
    }
  });

  it("the hosted shape (own McpServer, no explicit capability) also serves them", async () => {
    const client = await hostedClient();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates).toHaveLength(4);
  });

  it("maps each resource to the tool whose cap it spends", () => {
    expect(RESOURCE_TOOL).toEqual({
      profile: "get_company",
      financials: "get_financials",
      psc: "get_psc",
      compliance: "get_compliance",
    });
  });
});

describe("reading a resource", () => {
  const cases: Array<[string, string, string]> = [
    ["profile", "get_company", "/company/00445790"],
    ["financials", "get_financials", "/company/00445790/financials"],
    ["psc", "get_psc", "/company/00445790/psc"],
    ["compliance", "get_compliance", "/company/00445790/compliance"],
  ];

  for (const [name, tool, apiPath] of cases) {
    it(`company://00445790/${name} returns exactly what ${tool} returns`, async () => {
      const body = { data: { company_name: "TESCO PLC", marker: name } };
      const fetchSpy = mockFetchOk(body);
      const client = await stdioClient();

      const res = await client.readResource({ uri: `company://00445790/${name}` });
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(String(fetchSpy.mock.calls[0][0])).toBe(`${API_BASE}${apiPath}`);
      const content = res.contents[0] as { uri: string; mimeType?: string; text: string };
      expect(content.uri).toBe(`company://00445790/${name}`);
      expect(content.mimeType).toBe("application/json");

      const viaTool = await client.callTool({ name: tool, arguments: { company_number: "00445790" } });
      const toolText = (viaTool.content as { text: string }[])[0].text;
      expect(content.text).toBe(toolText);
      expect(JSON.parse(content.text)).toEqual(body);
    });
  }

  it("zero-pads a short numeric number and upper-cases letters", async () => {
    const fetchSpy = mockFetchOk({ ok: true });
    const client = await stdioClient();
    await client.readResource({ uri: "company://445790/profile" });
    await client.readResource({ uri: "company://sc123456/profile" });
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${API_BASE}/company/00445790`);
    expect(String(fetchSpy.mock.calls[1][0])).toBe(`${API_BASE}/company/SC123456`);
  });

  it("rejects an invalid company number without calling the API", async () => {
    const fetchSpy = mockFetchOk({});
    const client = await stdioClient();
    await expect(client.readResource({ uri: "company://not-a-number!!/profile" })).rejects.toThrow();
    await expect(client.readResource({ uri: "company://123456789/profile" })).rejects.toThrow(/1-8/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces an upstream API failure as a protocol error, not an empty read", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"detail":"not found"}'),
    } as Response);
    const client = await stdioClient();
    await expect(client.readResource({ uri: "company://00000001/profile" })).rejects.toThrow(/404/);
  });
});

describe("resources go through the same quota gate as the tools", () => {
  it("passes the matching tool name to the gate", async () => {
    mockFetchOk({ ok: true });
    const seen: ToolName[] = [];
    const client = await hostedClient(async (tool) => {
      seen.push(tool);
      return null;
    });
    for (const r of ["profile", "financials", "psc", "compliance"]) {
      await client.readResource({ uri: `company://00445790/${r}` });
    }
    expect(seen).toEqual(["get_company", "get_financials", "get_psc", "get_compliance"]);
  });

  it("a refusal never reaches the API and comes back as readable text", async () => {
    const fetchSpy = mockFetchOk({ ok: true });
    const message = "You've used your free lookups for today. A free Registrum key gives you more.";
    const client = await hostedClient(async () => message);

    const res = await client.readResource({ uri: "company://00445790/psc" });

    expect(
      fetchSpy,
      "the gate must run BEFORE the upstream call; a resource that fetched first would spend the shared Companies House budget"
    ).not.toHaveBeenCalled();
    const content = res.contents[0] as { text: string; mimeType?: string };
    expect(content.text).toBe(message);
    expect(content.mimeType).toBe("text/plain");
  });

  it("a gate that refuses one tool leaves the others readable", async () => {
    mockFetchOk({ ok: true });
    const client = await hostedClient(async (tool) => (tool === "get_compliance" ? "cap reached" : null));
    const denied = await client.readResource({ uri: "company://00445790/compliance" });
    const allowed = await client.readResource({ uri: "company://00445790/profile" });
    expect((denied.contents[0] as { text: string }).text).toBe("cap reached");
    expect((allowed.contents[0] as { text: string }).text).toContain("ok");
  });
});
