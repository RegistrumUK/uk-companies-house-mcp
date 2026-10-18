import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { VERSION, USER_AGENT } from "./version.js";
import { TRIAL_DAYS } from "./trial.js";

export const API_BASE = "https://api.registrum.co.uk/v1";

export async function callApi(
  path: string,
  apiKey: string,
  baseUrl: string = API_BASE
): Promise<unknown> {
  if (!apiKey) {
    throw new Error(
      "REGISTRUM_API_KEY is not set. To try it with no key, point your MCP client at https://registrum.co.uk/api/mcp. " +
        `For a free key (${TRIAL_DAYS} days of full access, no card) sign up at https://registrum.co.uk/?utm_source=mcp&utm_campaign=server and set it in your MCP client config.`
    );
  }
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "X-API-Key": apiKey, "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

function text(content: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(content, null, 2) }],
  };
}

/**
 * The shape OpenAI's connector contract requires for `search` and `fetch`:
 * the object as structuredContent AND as a JSON string in a text block.
 */
function structured(obj: Record<string, unknown>) {
  return {
    structuredContent: obj,
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  };
}

/**
 * title plus the five hints every tool carries. All of this server's tools read
 * public register data over HTTP GET: read-only, never destructive, safe to
 * repeat, and talking to an external system. Directories and clients use these
 * to decide what needs a confirmation prompt, so they are set in one place and
 * annotations.test.ts fails if a registered tool lacks any of them.
 */
function toolMeta(title: string) {
  return {
    title,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  };
}

function err(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * Every tool this server exposes, in registration order.
 *
 * Exported because more than one surface has to agree on it: the stdio package,
 * the hosted anonymous endpoint, and the drift test that asserts the two match.
 * The MCP README advertised five tools while the server registered eight for
 * five months - a list nobody could enumerate programmatically is a list that
 * goes stale.
 */
export const TOOL_NAMES = [
  "search_company",
  "get_company",
  "get_financials",
  "get_directors",
  "get_compliance",
  "get_psc",
  "get_psc_chain",
  "get_network",
  "get_bundle",
  "search",
  "fetch",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Called before a tool touches the API. Return a string to refuse the call with
 * that message; return null to allow it.
 *
 * This is how the hosted anonymous endpoint enforces per-tool daily caps
 * without the tool definitions knowing anything about IPs, Supabase or quotas.
 * The stdio package passes no quota at all, so a user with their own API key is
 * unaffected - their limits are enforced upstream against their own key.
 *
 * The refusal is deliberately returned as tool *text* rather than thrown: the
 * calling model reads it and relays the upgrade path to the user in its own
 * words, which makes the cap a conversion surface instead of an error.
 */
export type QuotaCheck = (tool: ToolName) => Promise<string | null>;

export interface RegisterToolsOptions {
  apiKey: string;
  baseUrl?: string;
  quota?: QuotaCheck;
}

/** Display name and brand icons shown by MCP clients; server.json must list the same icons. */
export const SERVER_TITLE = "UK Companies House (Registrum)";
export const SERVER_ICONS = [
  { src: "https://registrum.co.uk/brand/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
  { src: "https://registrum.co.uk/brand/icon-192.png", mimeType: "image/png", sizes: ["192x192"] },
  { src: "https://registrum.co.uk/brand/app-icon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
];

/**
 * The playbook a client shows the model once, at connect time. It teaches the
 * shape of an investigation and how to read the results; it deliberately does
 * not carry the answers (state tables, dates, filing-type or role lists), which
 * the API computes and the tool descriptions point at. instructions.test.ts
 * locks the sentences that stop a model misreporting data.
 */
export const SERVER_INSTRUCTIONS = [
  "Registrum serves live UK Companies House data through read-only tools. " +
    "Data is from Companies House via Registrum - do not supplement with web search.",
  "",
  "Investigating a company:",
  "1. Resolve a name to a number with search_company. Company numbers are zero-padded 8-character strings " +
    "(Tesco PLC is '00445790'); Scottish and other prefixed numbers keep their letters.",
  "2. get_company for the profile, then get_directors for officers, get_psc_chain to trace corporate owners up to the " +
    "ultimate beneficial owners, then get_compliance for ECCTA identity-verification status.",
  "3. Add get_financials for parsed accounts, get_psc for the flat register of who controls a company, " +
    "and get_network for companies linked by shared directors.",
  "",
  "Choosing the first call:",
  "- If you will need more than one view of a company, start with get_bundle: profile, compliance, financials, " +
    "PSCs and directors for one credit and one round trip, instead of five calls.",
  "- For broad questions, or a client that only supports search and fetch (such as ChatGPT), use `search` " +
    "then `fetch` each returned id. Otherwise prefer the specific tools.",
  "- The same data is readable as resources: company://{number}/profile, company://{number}/financials, " +
    "company://{number}/psc and company://{number}/compliance return what the matching tool returns.",
  "",
  "Reading results correctly:",
  "- ECCTA verification: `pending` means the deadline has not passed and is not a failure; `unknown` is an absence " +
    "of record; only `overdue` is a missed deadline; corporate PSCs carry no verification fields, so never say a " +
    "company itself is unverified.",
  "- `available: false` on financials means no figures could be extracted, not that the company has no accounts.",
  "- A corporate PSC `company_number` of null is not a missing lookup; do not search for it. The registry fields say " +
    "what was filed.",
  "- Listed PLCs are exempt from the PSC regime, so an empty chain is legitimate, not an error.",
  "- A null section in get_bundle means not available for that company or plan; report it that way, not as a failed lookup.",
  "- If a call returns a usage-limit message, tell the user what it says rather than retrying.",
].join("\n");

const companyNumber = z
  .string()
  .regex(/^[A-Z0-9]{1,8}$/, "Must be 1-8 alphanumeric characters")
  .describe(
    "Companies House company number, e.g. '00445790' for Tesco PLC. " +
      "Numeric-only numbers should be zero-padded to 8 digits."
  );

const SITE_COMPANY_URL = "https://registrum.co.uk/company/";

/** `company:<number>` or a bare number -> normalised company number, or null if invalid. */
function parseFetchId(raw: string): string | null {
  let v = raw.replace(/\s+/g, "").toUpperCase();
  if (v.includes(":")) {
    if (!v.startsWith("COMPANY:")) return null;
    v = v.slice("COMPANY:".length);
  }
  if (!/^[A-Z0-9]{1,8}$/.test(v)) return null;
  return /^[0-9]+$/.test(v) ? v.padStart(8, "0") : v;
}

/**
 * Resource name -> the tool whose daily cap it spends.
 *
 * A resource read goes through the same quota gate as the tool that returns the
 * same JSON, under that tool's name. No new gate name exists for the hosted
 * endpoint to forget, and a resource is not a side door around a keyless cap.
 */
export const RESOURCE_TOOL = {
  profile: "get_company",
  financials: "get_financials",
  psc: "get_psc",
  compliance: "get_compliance",
} as const satisfies Record<string, ToolName>;

type ResourceName = keyof typeof RESOURCE_TOOL;

const RESOURCE_DESCRIPTIONS: Record<ResourceName, string> = {
  profile: "Enriched profile of a UK company: status, type, incorporation date, registered address, SIC codes, accounts and confirmation statement status. The same JSON as the get_company tool.",
  financials: "Structured figures parsed from a UK company's filed accounts, with a data_quality block. available: false means no figures could be extracted, not that the company has no accounts. The same JSON as the get_financials tool.",
  psc: "The PSC (Persons with Significant Control) register for a UK company, with ECCTA verification on individuals. The same JSON as the get_psc tool.",
  compliance: "ECCTA identity-verification status for a UK company's directors and PSCs: pending is a deadline not yet passed, only overdue is a missed deadline. The same JSON as the get_compliance tool.",
};

/** The `{number}` of a company:// URI -> normalised company number, or null if invalid. */
function parseResourceNumber(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string") return null;
  let v: string;
  try {
    v = decodeURIComponent(raw).trim().toUpperCase();
  } catch {
    return null;
  }
  if (!/^[A-Z0-9]{1,8}$/.test(v)) return null;
  return /^[0-9]+$/.test(v) ? v.padStart(8, "0") : v;
}

/**
 * Registers all tools on a server instance.
 *
 * Split out of createServer so the hosted HTTP endpoint can reuse the exact
 * same tool definitions. `createMcpHandler` takes a factory callback rather
 * than a server instance, so without this seam the only way to host these tools
 * would be to copy them into the website repo - which is precisely the
 * copy-drifts-from-source failure this codebase keeps paying for.
 */
export function registerTools(server: McpServer, options: RegisterToolsOptions): McpServer {
  const { apiKey, baseUrl = API_BASE, quota } = options;

  /**
   * The quota gate, then the upstream call. Tools and resources both go through
   * this, so a cap cannot be enforced on one surface and missed on the other.
   * Resolves to the refusal text when the gate says no (the API is never
   * called), otherwise to the parsed API body. Rejects on an upstream failure.
   */
  const gated = async (
    tool: ToolName,
    path: string
  ): Promise<{ denial: string } | { body: unknown }> => {
    const denial = await quota?.(tool);
    if (denial) return { denial };
    return { body: await callApi(path, apiKey, baseUrl) };
  };

  /** Runs the quota gate, then the call. Every tool body goes through this. */
  const run = async (
    tool: ToolName,
    path: string,
    shape: (body: unknown) => unknown = text
  ) => {
    try {
      const result = await gated(tool, path);
      if ("denial" in result) return err(result.denial);
      return shape(result.body) as ReturnType<typeof text>;
    } catch (e) {
      return err(String(e));
    }
  };

  server.registerTool(
    "search_company",
    {
      ...toolMeta("Search for companies"),
      description:
        "Search for UK companies by name. Returns a list of matching companies with " +
        "their company number, status, type, and registered address. Use this first " +
        "when you only have a company name and need its company number.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Company name or keywords to search for"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum number of results to return (default 20)"),
      }),
    },
    async ({ query, limit }) => {
      const params = new URLSearchParams({ q: query });
      if (limit) params.set("items_per_page", String(limit));
      return run("search_company", `/search?${params}`);
    }
  );

  server.registerTool(
    "get_company",
    {
      ...toolMeta("Get company profile"),
      description:
        "Get an enriched profile for a UK company by its Companies House number. " +
        "Returns name, status, type, incorporation date, registered address, SIC codes " +
        "with descriptions, accounts status, confirmation statement status, and derived " +
        "fields like company_age_years and accounts.overdue that are not available from " +
        "the raw Companies House API.",
      inputSchema: z.object({ company_number: companyNumber }),
    },
    async ({ company_number }) => run("get_company", `/company/${company_number}`)
  );

  server.registerTool(
    "get_financials",
    {
      ...toolMeta("Get company financials"),
      description:
        "Get structured financial data for a UK company, parsed from its iXBRL accounts " +
        "filed at Companies House. Returns revenue, cost of sales, gross profit, operating " +
        "profit, net profit, fixed assets, current assets, total equity, net assets, " +
        "creditors, and average employees for the current and prior reporting year. " +
        "Also includes accounts_type (full, abbreviated, micro, dormant or unknown) and a " +
        "data_quality block indicating which fields were extracted and which were absent. " +
        "period_end is the end of the accounting period the figures cover (the year the accounts end), " +
        "NOT the date the accounts were filed; the filing date is data_quality.filed_on. " +
        "Other data_quality fields: filing_type (Companies House form code: AA, AAMD or AC(NI)), " +
        "period_end_source and accounts_type_source (how those two values were determined), and " +
        "accounts_description_code (the verbatim Companies House code, e.g. unaudited-abridged, " +
        "micro-entity). Unaudited-abridged, small and audit-exemption-subsidiary filings are " +
        "abbreviated, not full, and carry no profit and loss (check has_profit_loss). " +
        "accounts_type is unknown when it could not be determined; do not assume full. " +
        "The response can be available: false with an unavailable_reason: image_pdf (accounts filed as a " +
        "scanned PDF, common for large companies such as Tesco), no_ixbrl_filings (no digital filing), or " +
        "dissolved. That means no figures could be extracted; it does not mean the company has no accounts. " +
        "Cached for 7 days.",
      inputSchema: z.object({ company_number: companyNumber }),
    },
    async ({ company_number }) => run("get_financials", `/company/${company_number}/financials`)
  );

  server.registerTool(
    "get_directors",
    {
      ...toolMeta("Get company officers (directors and secretaries)"),
      description:
        "Get the current and past officers for a UK company. Despite the tool name, not every " +
        "entry is a director: the list is the full officer register, so each entry carries an " +
        "officer_role such as 'director', 'secretary', 'corporate-secretary' or 'llp-member', " +
        "plus an is_board_director boolean that is false for secretaries. Report each person by " +
        "their own officer_role - never describe the whole list as directors. " +
        "Each officer includes name, officer_role, is_board_director, appointment date, " +
        "resignation date (if applicable), nationality, occupation, month and year of birth, " +
        "ECCTA verification status, and a list of other companies they are or were appointed to, " +
        "each with its own officer_role. This gives you a full picture of an officer's corporate " +
        "history in one call.",
      inputSchema: z.object({ company_number: companyNumber }),
    },
    async ({ company_number }) => run("get_directors", `/company/${company_number}/directors`)
  );

  server.registerTool(
    "get_compliance",
    {
      ...toolMeta("Check ECCTA identity-verification compliance"),
      description:
        "Check a UK company's ECCTA identity-verification status - who has verified their " +
        "identity with Companies House, who is still pending, and who is overdue. " +
        "The Economic Crime and Corporate Transparency Act requires every director and PSC to " +
        "verify their identity; enforcement begins 18 November 2026, after which unverified " +
        "officers can block filings. " +
        "Returns per-company counts (directors_total, directors_verified, directors_pending, " +
        "directors_overdue) and the same for PSCs, plus unverified_persons with each person's " +
        "name, role, status and their individual deadline. " +
        "IMPORTANT: 'pending' means the deadline has not yet passed - it is NOT a failure and " +
        "must not be reported as one. Only 'overdue' means a deadline was missed. " +
        "Requires a Pro plan or above. Cached for 24 hours.",
      inputSchema: z.object({ company_number: companyNumber }),
    },
    async ({ company_number }) => run("get_compliance", `/company/${company_number}/compliance`)
  );

  server.registerTool(
    "get_psc",
    {
      ...toolMeta("Get persons with significant control"),
      description:
        "Get the PSC (Persons with Significant Control) register for a UK company. " +
        "Returns individuals, corporate entities, and legal persons who own 25%+ of shares, " +
        "hold 25%+ of voting rights, or have significant influence or control. " +
        "Each PSC includes decoded control types in plain English (e.g. 'Owns 25-50% of shares' " +
        "instead of raw codes). Individual PSCs also carry ECCTA identity verification: " +
        "verification_status (verified, pending, overdue or unknown), identity_verified, " +
        "identity_verified_on, and verification_deadline. pending means that person's deadline " +
        "has not yet passed and is not a compliance failure; unknown means Companies House " +
        "publishes no record for them, an absence of data rather than a breach. Only overdue " +
        "means a deadline was missed. " +
        "Corporate entity PSCs carry none of the verification fields. Their company_number " +
        "is set only for a confirmed Companies House registration and is otherwise null, " +
        "so never treat a null as a missing value to look up. What they filed is in " +
        "registry_number and registry_name, and registry_is_companies_house says how to read it: " +
        "true is a Companies House registration, null means a number was filed but cannot be " +
        "tied to the UK register (e.g. a foreign registry), false means no number was filed. " +
        "kind can be unknown for a PSC type we do not classify, with Companies House's " +
        "verbatim string in kind_raw. " +
        "Also detects PSC exemptions for listed PLCs. " +
        "Cached for 24 hours.",
      inputSchema: z.object({ company_number: companyNumber }),
    },
    async ({ company_number }) => run("get_psc", `/company/${company_number}/psc`)
  );

  /** The sections /v1/company/{n}/bundle can assemble, in the API's own order.
   *
   * A closed enum rather than a free string: the API answers an unknown
   * section with a 400, and a model that guesses "accounts" should be told the
   * valid names by the schema instead of spending a call to find out.
   */
  const BUNDLE_SECTIONS = ["profile", "compliance", "financials", "psc", "directors"] as const;

  server.registerTool(
    "get_bundle",
    {
      ...toolMeta("Get a whole company in one request"),
      description:
        "Get several views of one UK company in a single request: profile, ECCTA compliance, " +
        "financials, PSCs and directors. Prefer this over calling get_company, get_compliance, " +
        "get_financials, get_psc and get_directors separately - it returns the same data for " +
        "one API call and one credit instead of five, and in a single round trip. " +
        "Pass include to fetch only the sections you need; omit it to get all five. " +
        "The profile is always returned. " +
        "Partial results are normal and are not errors: any section can come back null when it " +
        "is unavailable for that company or not included in the caller's plan - financials are " +
        "null for a company that has filed no machine-readable accounts, and compliance requires " +
        "a Pro plan. Report a null section as 'not available', never as a failed lookup or as an " +
        "absence of the underlying fact. Only a missing company is an error, and that is a 404. " +
        "Each section carries exactly what its own endpoint returns, including ECCTA " +
        "verification_status on individuals, so the pending-versus-overdue rules apply here too.",
      inputSchema: z.object({
        company_number: companyNumber,
        include: z
          .array(z.enum(BUNDLE_SECTIONS))
          .min(1)
          .optional()
          .describe(
            "Sections to fetch. Omit for all five. Valid values: " +
              BUNDLE_SECTIONS.join(", ") +
              ". The profile is always included regardless."
          ),
      }),
    },
    async ({ company_number, include }) =>
      run(
        "get_bundle",
        `/company/${company_number}/bundle${include?.length ? `?include=${encodeURIComponent(include.join(","))}` : ""}`
      )
  );

  server.registerTool(
    "get_psc_chain",
    {
      ...toolMeta("Resolve PSC ownership chain to find ultimate beneficial owners"),
      description:
        "Trace the full ownership chain for a UK company by recursively following corporate " +
        "entity PSCs. Returns a tree showing who ultimately controls the company - natural persons " +
        "(UBOs), foreign entities, or legal persons - along with why each branch terminated. " +
        "Each node has a terminal_reason: natural_person, foreign_entity, legal_person, " +
        "super_secure, unverified_registry, unknown_kind, depth_limit, not_found, " +
        "cycle_detected, or psc_exempt. Two of those are easy to misread: unverified_registry " +
        "means a registration number was filed but cannot be tied to the Companies House " +
        "register (a foreign registry, or one we do not recognise), which is a finding about " +
        "the ownership structure and not an error or an outage; unknown_kind means Companies " +
        "House returned a PSC type we do not classify (kind is then unknown), with the raw " +
        "value in kind_raw. Both are findings, not errors. A corporate node's company_number " +
        "is set only for a confirmed Companies House registration, otherwise null; the number " +
        "it filed is in registry_number with registry_name, and registry_is_companies_house is " +
        "true (Companies House), null (a number was filed but cannot be tied to the UK register) " +
        "or false (no number filed). " +
        "ECCTA identity verification: every individual node, at any depth including the " +
        "ultimate beneficial owners this chain exists to find, carries verification_status " +
        "(verified, pending, overdue or unknown), identity_verified (true, false for overdue " +
        "only, or null otherwise), identity_verified_on, and verification_deadline. " +
        "IMPORTANT: pending means that person's own deadline has not yet passed - it is not a " +
        "compliance failure and must not be reported as one. A status of unknown means " +
        "Companies House publishes no record for them, which is an absence of data rather " +
        "than a breach. Only overdue means a deadline was missed. Corporate, legal-person and " +
        "super-secure nodes carry none of these fields, so never describe a company itself as " +
        "having unverified identity. " +
        "chain_metadata reports how many companies were resolved and the total API credit cost. " +
        "Use this for KYB (Know Your Business) checks, AML screening, or any task requiring " +
        "beneficial ownership beyond the immediate PSC layer.",
      inputSchema: z.object({
        company_number: companyNumber,
        max_depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe(
            "Maximum chain depth to traverse (1-10, default 5). " +
              "Each level costs 1 upstream API call per corporate entity found."
          ),
      }),
    },
    async ({ company_number, max_depth }) =>
      run(
        "get_psc_chain",
        `/company/${company_number}/psc/chain${max_depth ? `?max_depth=${max_depth}` : ""}`
      )
  );

  server.registerTool(
    "get_network",
    {
      ...toolMeta("Get director network"),
      description:
        "Map the corporate network connected to a UK company via shared directors. " +
        "Returns all companies connected through shared board members, up to the specified " +
        "depth. Each connected company includes its name, number, status, and the directors " +
        "it shares with the focal company. Useful for identifying corporate group structures, " +
        "related party relationships, and director interlocks.",
      inputSchema: z.object({
        company_number: companyNumber,
        depth: z
          .number()
          .int()
          .min(1)
          .max(2)
          .optional()
          .describe(
            "Traversal depth: 1 = direct connections only, 2 = connections of connections (default 1). " +
              "Depth 2 can return many results for large companies."
          ),
      }),
    },
    async ({ company_number, depth }) =>
      run("get_network", `/company/${company_number}/network${depth ? `?depth=${depth}` : ""}`)
  );

  server.registerTool(
    "search",
    {
      ...toolMeta("Search companies"),
      description:
        "Search UK companies at Companies House by name or keywords. Returns an object with a " +
        "results array; each result has id (company:<number>, pass it to fetch), title (company name, " +
        "number and status) and url (the company page on registrum.co.uk). Up to 10 results, in " +
        "relevance order; results is empty when nothing matches. Use fetch on an id to read the company.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Company name or keywords to search for"),
      }),
    },
    async ({ query }) =>
      run("search", `/search?${new URLSearchParams({ q: query, items_per_page: "10" })}`, (body) => {
        const items = ((body as any)?.data?.items ?? []) as Array<Record<string, string>>;
        return structured({
          results: items.map((i) => ({
            id: `company:${i.company_number}`,
            title: `${i.company_name} (${i.company_number}, ${i.company_status})`,
            url: `${SITE_COMPANY_URL}${i.company_number}`,
          })),
        });
      })
  );

  server.registerTool(
    "fetch",
    {
      ...toolMeta("Fetch a company"),
      description:
        "Fetch one UK company by an id from search (company:<number>; a bare company number also works). " +
        "Returns an object with id, title (company name), url (company page on registrum.co.uk), " +
        "text (a plain-English summary followed by the full enriched profile as JSON: status, type, " +
        "incorporation date, registered address, SIC codes, accounts and confirmation statement status) " +
        "and metadata (company_number, company_status, company_type, source). Profile only; use " +
        "get_bundle, get_psc, get_directors or get_financials for ownership, officers and accounts.",
      inputSchema: z.object({
        id: z.string().describe("Company id from search, e.g. 'company:00445790'"),
      }),
    },
    async ({ id }) => {
      const number = parseFetchId(id);
      if (!number) {
        return err(
          `Invalid id '${id}'. The accepted form is company:<number> as returned by search, ` +
            "e.g. company:00445790 (a bare 1-8 character company number also works)."
        );
      }
      return run("fetch", `/company/${number}`, (body) => {
        const b = (body ?? {}) as any;
        // summary_md lives inside data on /company/{n}; it leads the text and is not repeated in the JSON.
        const { summary_md, ...data } = (b.data ?? {}) as Record<string, any>;
        const summary = typeof summary_md === "string" && summary_md ? summary_md : "";
        const json = JSON.stringify(data, null, 2);
        return structured({
          id: `company:${number}`,
          title: data.company_name ?? number,
          text: summary ? `${summary}

${json}` : json,
          url: `${SITE_COMPANY_URL}${number}`,
          metadata: {
            company_number: number,
            company_status: data.company_status,
            company_type: data.company_type,
            source: "Companies House via Registrum",
          },
        });
      });
    }
  );

  for (const name of Object.keys(RESOURCE_TOOL) as ResourceName[]) {
    server.registerResource(
      `company_${name}`,
      // list: undefined - there is no way to enumerate every company, so these
      // are templates a client fills in, not a resource list.
      new ResourceTemplate(`company://{number}/${name}`, { list: undefined }),
      {
        title: `Company ${name}`,
        description: RESOURCE_DESCRIPTIONS[name],
        mimeType: "application/json",
      },
      async (uri, variables) => {
        const number = parseResourceNumber(variables.number);
        if (!number) {
          throw new Error(
            `Invalid company number in ${uri.href}. Use company://<number>/${name} with a 1-8 character ` +
              "alphanumeric Companies House number, e.g. company://00445790/" + name + "."
          );
        }
        const path = name === "profile" ? `/company/${number}` : `/company/${number}/${name}`;
        const result = await gated(RESOURCE_TOOL[name], path);
        // A refusal is text, as it is for tools: the model relays the upgrade path.
        if ("denial" in result) {
          return { contents: [{ uri: uri.href, mimeType: "text/plain", text: result.denial }] };
        }
        return {
          contents: [
            { uri: uri.href, mimeType: "application/json", text: JSON.stringify(result.body, null, 2) },
          ],
        };
      }
    );
  }

  return server;
}

/** A stdio-ready server for a single user's own API key. */
export function createServer(apiKey: string, baseUrl: string = API_BASE): McpServer {
  const server = new McpServer(
    { name: "registrum", title: SERVER_TITLE, version: VERSION, icons: SERVER_ICONS },
    { capabilities: { tools: {}, resources: {} }, instructions: SERVER_INSTRUCTIONS }
  );
  return registerTools(server, { apiKey, baseUrl });
}
