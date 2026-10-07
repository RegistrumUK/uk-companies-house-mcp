import { McpServer } from "@modelcontextprotocol/server";
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

export const SERVER_INSTRUCTIONS =
  "Use these tools to look up UK companies registered at Companies House. " +
  "Company numbers are zero-padded 8-digit strings (e.g. '00445790' for Tesco PLC). " +
  "When a user gives you a company name, use search_company first to find the number, " +
  "then use get_company, get_financials, get_directors, get_psc, get_psc_chain, get_compliance, or get_network as needed. " +
  "Use get_psc for a flat view of who controls a company. Use get_compliance for ECCTA identity-verification status - note 'pending' means the deadline has not passed and is not a failure. " +
  "Use get_psc_chain to trace corporate ownership upward and find the ultimate beneficial owners (UBOs) " +
  "- it follows corporate entity PSCs recursively until reaching natural persons or foreign entities.";

const companyNumber = z
  .string()
  .regex(/^[A-Z0-9]{1,8}$/, "Must be 1-8 alphanumeric characters")
  .describe(
    "Companies House company number, e.g. '00445790' for Tesco PLC. " +
      "Numeric-only numbers should be zero-padded to 8 digits."
  );

/**
 * Registers all eight tools on a server instance.
 *
 * Split out of createServer so the hosted HTTP endpoint can reuse the exact
 * same tool definitions. `createMcpHandler` takes a factory callback rather
 * than a server instance, so without this seam the only way to host these tools
 * would be to copy them into the website repo - which is precisely the
 * copy-drifts-from-source failure this codebase keeps paying for.
 */
export function registerTools(server: McpServer, options: RegisterToolsOptions): McpServer {
  const { apiKey, baseUrl = API_BASE, quota } = options;

  /** Runs the quota gate, then the call. Every tool body goes through this. */
  const run = async (tool: ToolName, path: string) => {
    try {
      const denial = await quota?.(tool);
      if (denial) return err(denial);
      return text(await callApi(path, apiKey, baseUrl));
    } catch (e) {
      return err(String(e));
    }
  };

  server.registerTool(
    "search_company",
    {
      title: "Search for companies",
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
      title: "Get company profile",
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
      title: "Get company financials",
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
      title: "Get company officers (directors and secretaries)",
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
      title: "Check ECCTA identity-verification compliance",
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
      title: "Get persons with significant control",
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
      title: "Get a whole company in one request",
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
      title: "Resolve PSC ownership chain to find ultimate beneficial owners",
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
      title: "Get director network",
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

  return server;
}

/** A stdio-ready server for a single user's own API key. */
export function createServer(apiKey: string, baseUrl: string = API_BASE): McpServer {
  const server = new McpServer(
    { name: "registrum", version: VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );
  return registerTools(server, { apiKey, baseUrl });
}
