import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  terminalReasonsFrom,
  unavailableReasonsFrom,
  toolDescriptionFor,
  findMissing,
} from "../scripts/check-description-drift.mjs";

/** A tool description is this package's entire interface.
 *
 * `get_psc_chain` returned ECCTA verification on every individual node from
 * CH-Api#104 and never said so, and its terminal-reason list predated
 * CH-Api#59 and CH-Api#62 by two reasons (registrum-mcp#20). Both were
 * invisible rather than broken: a model that has not been told a field exists
 * does not ask the question that field answers.
 *
 * The pure functions are unit-tested against fixtures here; hitting the live
 * openapi.json is the script's job, the same split check-endpoint-coverage
 * uses, so the suite stays offline and deterministic.
 */
const server = readFileSync(join(__dirname, "server.ts"), "utf8");

const API_DESCRIPTION_FIXTURE = `
Resolve the PSC ownership chain.

**Terminal reasons** explain why a branch stopped:

- \`natural_person\` - reached an individual
- \`unverified_registry\` - a number is filed but cannot be tied to the register.
  \`registry_number\` and \`registry_name\` say what was filed.
- \`unknown_kind\` - a PSC kind we have not classified

**ECCTA identity verification.**

- \`verification_status\` - verified | pending | overdue | unknown
`;

describe("terminalReasonsFrom", () => {
  it("reads the reasons the API documents", () => {
    expect(terminalReasonsFrom(API_DESCRIPTION_FIXTURE)).toEqual([
      "natural_person",
      "unverified_registry",
      "unknown_kind",
    ]);
  });

  it("does not mistake a field named in the prose for a terminal reason", () => {
    // `registry_number` sits in an indented continuation line of a bullet.
    // Treating every backticked token as a reason would demand the tool
    // description list field names as if they were branch outcomes.
    expect(terminalReasonsFrom(API_DESCRIPTION_FIXTURE)).not.toContain("registry_number");
    expect(terminalReasonsFrom(API_DESCRIPTION_FIXTURE)).not.toContain("verification_status");
  });

  it("returns nothing for an empty description rather than throwing", () => {
    expect(terminalReasonsFrom("")).toEqual([]);
    expect(terminalReasonsFrom(undefined as unknown as string)).toEqual([]);
  });
});

describe("toolDescriptionFor", () => {
  it("collapses a concatenated description into one string", () => {
    const src = `server.registerTool(\n    "get_thing",\n    {\n      title: "T",\n      description:\n        "first part " +\n        "second part",\n      inputSchema: z.object({}),`;
    expect(toolDescriptionFor(src, "get_thing")).toBe("first part second part");
  });

  it("returns empty for a tool that is not registered", () => {
    expect(toolDescriptionFor("", "get_missing")).toBe("");
  });
});

describe("the shipped get_psc_chain description", () => {
  const description = toolDescriptionFor(server, "get_psc_chain");

  it("is found, so the assertions below are not vacuous", () => {
    expect(description.length).toBeGreaterThan(200);
  });

  it("names every terminal reason the API documents", () => {
    const canonical = terminalReasonsFrom(API_DESCRIPTION_FIXTURE);
    expect(findMissing(canonical, description)).toEqual([]);
  });

  it("names the two reasons that shipped without it", () => {
    // Guarded explicitly as well as by the fixture: these are the ones a
    // model misreads. `unverified_registry` is a real AML finding, not an
    // outage, and it used to surface as `not_found`.
    expect(findMissing(["unverified_registry", "unknown_kind"], description)).toEqual([]);
  });

  it("tells the model the chain carries ECCTA verification", () => {
    expect(findMissing(["verification_status", "identity_verified"], description)).toEqual([]);
  });

  it("states that pending is not a compliance failure", () => {
    // The CH-Api#52 rule, in the one place a model summarising a chain will
    // read it. Asserting the explanation is present, not that a word is
    // absent: "pending" must appear, it just must not stand alone.
    expect(description.toLowerCase()).toMatch(/pending.{0,120}(not a (compliance )?failure|has missed nothing|deadline has not)/s);
  });

  it("distinguishes unknown from a breach", () => {
    expect(description.toLowerCase()).toMatch(/unknown.{0,120}(no record|not a breach|absence)/s);
  });

  it("says non-individual nodes carry no verification fields", () => {
    // Without this a model reports a corporate node as having unverified
    // identity, which is a false finding about a named company.
    expect(description.toLowerCase()).toMatch(/(corporate|non-individual|only individual)/);
  });
});

describe("the shipped get_psc description", () => {
  const description = toolDescriptionFor(server, "get_psc");

  it("is found, so the assertions below are not vacuous", () => {
    expect(description.length).toBeGreaterThan(200);
  });

  it("names the ECCTA fields /psc has always returned", () => {
    // Found while fixing registrum-mcp#20, which assumed get_psc already
    // described these and said to mirror it. It did not: the flat PSC view
    // was silent on verification too.
    expect(findMissing(["verification_status"], description)).toEqual([]);
  });
});

describe("the shipped get_financials description", () => {
  const description = toolDescriptionFor(server, "get_financials");

  it("is found, so the assertions below are not vacuous", () => {
    expect(description.length).toBeGreaterThan(200);
  });

  it("says period_end is the accounting period end, not the filing date", () => {
    // CH-Api#67: a model told (or left to assume) that period_end is the
    // filing date reasons about the wrong financial year.
    expect(description.toLowerCase()).toMatch(/period_end.{0,80}accounting period/s);
    expect(description.toLowerCase()).toMatch(/period_end.{0,160}not the (date|filing)/s);
  });

  it("names the five data_quality fields added 2026-08-01", () => {
    expect(
      findMissing(
        ["filed_on", "filing_type", "period_end_source", "accounts_type_source", "accounts_description_code"],
        description,
      ),
    ).toEqual([]);
  });

  it("allows accounts_type unknown and says abridged filings are abbreviated", () => {
    expect(findMissing(["unknown", "abbreviated"], description)).toEqual([]);
    expect(description.toLowerCase()).toMatch(/abridged.{0,120}abbreviated/s);
  });
});

describe("unavailableReasonsFrom", () => {
  it("reads the quoted reasons listed after unavailable_reason", () => {
    const fixture =
      'returns HTTP 200 with `available: false`, `unavailable_reason` (`"dissolved"`, `"no_ixbrl_filings"` or `"image_pdf"`), `company_status`, and more.';
    expect(unavailableReasonsFrom(fixture)).toEqual(["dissolved", "no_ixbrl_filings", "image_pdf"]);
  });

  it("returns nothing when the API stops listing them", () => {
    expect(unavailableReasonsFrom("")).toEqual([]);
    expect(unavailableReasonsFrom(undefined as unknown as string)).toEqual([]);
  });
});

describe("the shipped get_financials description on available=false", () => {
  const description = toolDescriptionFor(server, "get_financials");

  it("names available and unavailable_reason", () => {
    expect(findMissing(["available", "unavailable_reason"], description)).toEqual([]);
  });

  it("names every unavailable_reason value the API documents", () => {
    // Fixture mirrors the API's own sentence; the live check is the script's job.
    expect(findMissing(["dissolved", "no_ixbrl_filings", "image_pdf"], description)).toEqual([]);
  });

  it("says no figures does not mean no accounts", () => {
    expect(description.toLowerCase()).toMatch(/available.{0,200}(not (mean|that)|does not mean).{0,80}no accounts/s);
  });
});

describe("the shipped PSC descriptions on corporate-entity registry fields", () => {
  for (const tool of ["get_psc", "get_psc_chain"]) {
    const description = toolDescriptionFor(server, tool);

    it(`${tool} names the registry fields and the confirmed-registration rule`, () => {
      expect(
        findMissing(
          ["registry_number", "registry_name", "registry_is_companies_house", "kind_raw"],
          description,
        ),
      ).toEqual([]);
      expect(description.toLowerCase()).toMatch(/company_number.{0,120}(only|confirmed)/s);
    });
  }

  it("get_psc_chain says kind can be unknown", () => {
    expect(toolDescriptionFor(server, "get_psc_chain")).toMatch(/kind[^.]{0,40}unknown/);
  });
});
