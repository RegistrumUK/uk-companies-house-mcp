# Registrum MCP Server

**UK company data in your AI agent — without building Companies House plumbing.**

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.vdmeu%2Fregistrum--mcp-4F7BFF)](https://registry.modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/@registrum/mcp?color=22D3A0&label=npm)](https://www.npmjs.com/package/@registrum/mcp)
[![Status](https://img.shields.io/badge/status-live-22D3A0)](https://status.registrum.co.uk)
[![Docs](https://img.shields.io/badge/API-reference-7A8FAD)](https://api.registrum.co.uk/docs)

No Companies House developer account, no rate-limit handling, no iXBRL parsing.
Works in Claude Desktop, Claude Code, Cursor, and any MCP-compatible client.

## Try it now — no signup, no key, no install

Point your client at the hosted endpoint and every tool answers with real data:

```
https://registrum.co.uk/api/mcp
```

```json
{
  "mcpServers": {
    "registrum": {
      "url": "https://registrum.co.uk/api/mcp"
    }
  }
}
```

That is the whole setup. Ask it *"Who ultimately owns BrewDog?"* and it will trace
the ownership chain to the named individuals who hold control.

One thing worth knowing before you test it on a household name: companies listed
on a regulated market — Tesco, Rolls-Royce, most of the FTSE — are **exempt from
the PSC regime**, so their ownership chain is legitimately empty and
`get_psc_chain` says so rather than inventing a tree. Ownership questions are
interesting on private companies, which is where the register actually records
who is behind them.

The hosted endpoint has small daily caps, enough to see exactly what comes back.
When you reach one, the tool tells you so and points at a free key; nothing
silently degrades.

## Three ways to use it

1. **Try it - no key.** Point your MCP client at `https://registrum.co.uk/api/mcp`
   and ask about any UK company. No signup.
2. **Build with it - free key.** 60 days of full access: every endpoint, no
   monthly cap, no card. After that the key stays free for light use.
3. **Run on it - paid plan.** When you need volume, premium endpoints or an SLA.
   Live prices and limits: [`GET /v1/plans`](https://api.registrum.co.uk/v1/plans).

---

## Why this instead of the Companies House API directly

Companies House publishes the raw register for free, and you can absolutely
call it yourself. What you then own is the plumbing:

| Doing it yourself | With Registrum |
|---|---|
| Register for a CH developer key, manage OAuth | Nothing, or one `REGISTRUM_API_KEY` |
| 600 requests/5min, and you handle the 429s | Server-side throttling on a higher negotiated budget |
| Accounts arrive as iXBRL documents you must parse | `get_financials` returns turnover, net assets, profit/loss as numbers |
| PSC control types are raw codes | Decoded to plain English |
| Ownership chains: recurse yourself, handle cycles | `get_psc_chain` returns the resolved tree with termination reasons |
| Director networks: N+1 queries across appointments | `get_network` traverses to depth 2 |
| Retry, cache, and survive CH outages yourself | 24h/7d caching, circuit breaker, stale-while-revalidate |

Other Companies House MCP servers make you bring your own CH key and hand back
the raw response. This one does the enrichment.

---

## Running it with your own key

Use a key to build on it (60 days of full access), or when you would rather run
the server locally than call ours.

**Claude Desktop** — `~/.claude/claude_desktop_config.json`
**Cursor** — `.cursor/mcp.json` (per project) or `~/.cursor/mcp.json` (global)

```json
{
  "mcpServers": {
    "registrum": {
      "command": "npx",
      "args": ["-y", "@registrum/mcp"],
      "env": { "REGISTRUM_API_KEY": "reg_live_..." }
    }
  }
}
```

[Get a free key](https://registrum.co.uk/?utm_source=mcp&utm_campaign=readme) — 60 days of full access, no card.

---

## Tools

| Tool | What you get |
|---|---|
| `search_company` | Find a company by name → company number |
| `get_bundle` | **Profile, compliance, financials, PSCs and directors in one call** - start here |
| `get_company` | Profile: status, age, SIC descriptions, overdue flags |
| `get_financials` | Turnover, net assets, profit/loss, employees — parsed from iXBRL, in GBP |
| `get_directors` | Current board with appointment history across all their companies |
| `get_psc` | Persons with Significant Control, control types in plain English |
| `get_psc_chain` | Ownership traversed to ultimate beneficial owners, with termination reasons |
| `get_compliance` | **ECCTA identity-verification status** — who has verified, who is pending, who is overdue |
| `get_network` | Companies connected by shared directors, to depth 2 |

### On `get_bundle`

Most questions about a company need several of these views at once. `get_bundle`
returns them in a single request: **one call and one credit instead of five**,
and one round trip instead of five. Pass `include` to fetch a subset, or omit it
for all five sections.

Each section carries exactly what its own endpoint returns, because the bundle
is composed from those same handlers rather than reimplemented - so plan gates,
caching and the ECCTA rules behave identically either way.

**A null section is not an error.** Financials come back null for a company that
has filed no machine-readable accounts, and compliance requires a Pro plan. Only
a missing company is an error, and that is a 404. Report a null section as "not
available", never as an absence of the underlying fact.

### On `get_compliance`

The Economic Crime and Corporate Transparency Act requires every UK director
and PSC to verify their identity with Companies House. **Enforcement begins
18 November 2026**, after which unverified officers can block filings.

The tool returns verified / pending / overdue counts plus each unverified
person and their individual deadline. It deliberately distinguishes **pending**
(deadline not yet reached — not a failure) from **overdue** (missed). Treating
those as the same thing is the single easiest way to report a compliant company
as non-compliant.

---

## Example prompts

> "Is Tesco PLC compliant with ECCTA director verification, and who still needs to verify?"

> "Pull the last filed financials for 00445790 and tell me if turnover grew."

> "Who ultimately owns BrewDog? Trace the ownership chain to the individuals."

> "Which companies share directors with Barratt Developments?"

> "Search for 'Monzo' and show me status, incorporation date and directors."

---

## Plans

The anonymous endpoint needs no account at all. A free key gives 60 days of full
access, then stays free for light use; paid tiers add volume, premium endpoints
such as PSC chain traversal and the ECCTA compliance endpoint, and an SLA.

Prices and quotas are served live from [`GET /v1/plans`](https://api.registrum.co.uk/v1/plans) —
that endpoint is the source of truth, so this README does not duplicate the
numbers and cannot go stale against them. Human-readable version at
[registrum.co.uk](https://registrum.co.uk/?utm_source=mcp&utm_campaign=readme#pricing).

---

## Notes

- Company numbers are zero-padded 8-character strings: `00445790`, `SC000268`.
- Responses are JSON, cached server-side (24h profiles/directors, 7d financials).
- The hosted endpoint is stateless and anonymous: it stores no account, and rate
  limiting is keyed on a hash of the calling IP rather than anything about you.
- The npm package sends `User-Agent: @registrum/mcp/<version>` so we can see
  which features developers actually use. No telemetry runs on your machine.

[API reference](https://api.registrum.co.uk/docs) · [Issues](https://github.com/vdmeu/registrum-mcp/issues) · [support@registrum.co.uk](mailto:support@registrum.co.uk)
