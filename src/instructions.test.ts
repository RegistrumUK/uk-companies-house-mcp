import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS, TOOL_NAMES } from "./server.js";

/**
 * SERVER_INSTRUCTIONS is the playbook a client shows the model once, at connect
 * time (RegistrumUK/uk-companies-house-mcp#53). Two things must stay true of it:
 *
 *   1. The sentences that stop a model misreporting data survive any edit. They
 *      are asserted by string containment, in the style of description-drift.test.ts,
 *      so a tidy-up cannot quietly drop one.
 *   2. It teaches the shape of an investigation, never the answers: no ECCTA
 *      state table, sentinel dates, filing-type allow-lists or officer-role
 *      exclusions (the moat rule in registrum-landscape decisions.md). Those stay
 *      in the API, where they are computed.
 */
const words = (s: string) => s.trim().split(/\s+/).length;

describe("SERVER_INSTRUCTIONS size", () => {
  it("is a playbook, not a hint: at least 150 words", () => {
    expect(words(SERVER_INSTRUCTIONS)).toBeGreaterThanOrEqual(150);
  });

  it("stays at or under 400 words", () => {
    expect(words(SERVER_INSTRUCTIONS)).toBeLessThanOrEqual(400);
  });
});

describe("SERVER_INSTRUCTIONS semantics that must survive", () => {
  const must: Array<[string, string]> = [
    [
      "ECCTA verification wording (CH-Api#52)",
      "`pending` means the deadline has not passed and is not a failure; `unknown` is an absence of record; " +
        "only `overdue` is a missed deadline; corporate PSCs carry no verification fields",
    ],
    [
      "financials unavailable",
      "`available: false` on financials means no figures could be extracted, not that the company has no accounts",
    ],
    [
      "corporate PSC company_number",
      "a corporate PSC `company_number` of null is not a missing lookup",
    ],
    ["zero padding", "zero-padded 8-character"],
    ["provenance", "data is from Companies House via Registrum - do not supplement with web search"],
    [
      "listed PLC PSC exemption",
      "listed PLCs are exempt from the PSC regime, so an empty chain is legitimate",
    ],
    [
      "lifecycle - absence is not current (claude-ch-proj#14)",
      "a missing resignation or cessation date is not evidence of a current role",
    ],
    ["lifecycle - ended companies", "`company_is_live: false`"],
    ["lifecycle - per-appointment flag", "check `is_current` before calling any appointment a current role"],
    [
      "identity - officer ID fragmentation and name collisions",
      "one person can hold several officer ids and different people share names",
    ],
  ];

  for (const [label, sentence] of must) {
    it(`keeps: ${label}`, () => {
      expect(SERVER_INSTRUCTIONS.toLowerCase()).toContain(sentence.toLowerCase());
    });
  }
});

describe("SERVER_INSTRUCTIONS investigation shape", () => {
  it("walks search_company -> get_company -> get_directors -> get_psc_chain -> get_compliance in order", () => {
    const order = ["search_company", "get_company", "get_directors", "get_psc_chain", "get_compliance"];
    const at = order.map((t) => SERVER_INSTRUCTIONS.indexOf(t));
    expect(at.every((i) => i >= 0), `missing from instructions: ${order.filter((_, i) => at[i] < 0)}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("says when get_bundle is the better first call", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/get_bundle/);
    expect(SERVER_INSTRUCTIONS).toMatch(/one credit/i);
  });

  it("keeps the search then fetch route for broad queries and ChatGPT", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/`search` then `fetch`/);
    expect(SERVER_INSTRUCTIONS).toContain("ChatGPT");
  });

  it("names the resource templates", () => {
    for (const r of ["profile", "financials", "psc", "compliance"]) {
      expect(SERVER_INSTRUCTIONS).toContain(`company://{number}/${r}`);
    }
  });

  it("only names tools that exist", () => {
    const named = [...SERVER_INSTRUCTIONS.matchAll(/\b(get_[a-z_]+|search_company)\b/g)].map((m) => m[1]);
    for (const n of named) expect(TOOL_NAMES as readonly string[], n).toContain(n);
  });
});

describe("SERVER_INSTRUCTIONS moat rule: teach the shape, never the answers", () => {
  it("states no calendar date (no enforcement date, no sentinel date)", () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(SERVER_INSTRUCTIONS).not.toMatch(
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i
    );
  });

  it("carries no filing-type allow-list or officer-role exclusion list", () => {
    for (const leak of ["AAMD", "AC(NI)", "unaudited-abridged", "micro-entity", "corporate-secretary", "llp-member", "nominee"]) {
      expect(SERVER_INSTRUCTIONS, `leaks ${leak}`).not.toContain(leak);
    }
  });

  it("has no table of verification states per case (one sentence defines them, no matrix)", () => {
    expect(SERVER_INSTRUCTIONS).not.toContain("|");
  });
});
