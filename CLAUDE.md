# @registrum/mcp - Claude Code Instructions

MCP server exposing the Registrum API to LLM clients. TypeScript, published to npm as
`@registrum/mcp`. Root: `/c/users/eugen/claude-ch-proj/mcp`. Repo: `RegistrumUK/uk-companies-house-mcp` (was vdmeu/registrum-mcp until 2026-10-08; npm package keeps @registrum/mcp, registry name is io.github.RegistrumUK/uk-companies-house-mcp, Glama path may still be the old one).

```bash
npm run build        # tsc
npm test             # vitest
node scripts/check-endpoint-coverage.mjs     # every API endpoint has a tool
node scripts/check-param-drift.mjs           # every param a tool sends is declared
node scripts/check-description-drift.mjs     # descriptions still describe what the API returns
```

## DONE = PUBLISHED AND CONSUMED. A push here ships nothing.

This repo has the longest gap between "pushed" and "a user is served it", and it is the one place
where a green test suite is most misleading. Two hops, both required:

1. **Publish.** `npm version patch` (its `version` script syncs `server.json`) then
   `git push --follow-tags`. The tag fires `publish.yml`, which publishes via OIDC trusted
   publishing - no token, nothing to expire. Verify with `npm view @registrum/mcp version`, and
   for anything textual grep the packed tarball (`npm pack @registrum/mcp@<v>`), because the
   version number only proves a release happened, not that it carries your change.
2. **Bump the consumer.** The hosted endpoint at `registrum.co.uk/api/mcp` imports `registerTools`
   from this package rather than redefining the tools, so it serves whatever the **website
   lockfile** pins. `npm install @registrum/mcp@<version>` in `website/`, commit, push. A `^range`
   in `package.json` does not move a pinned `package-lock.json`.

Skipping step 1 leaves everyone on the old version; skipping step 2 leaves every hosted user on it.
Both happened on 2026-08-30 with the ECCTA description fix (#20).

Ship bugfixes without asking - a patch release is a normal release, not an irreversible action
needing sign-off.

## The tool description IS the interface

A field the description never names is a field the model never asks about, so this package can be
correct, shipped, and useless at once. `get_psc_chain` returned ECCTA verification for months
without saying so (#20).

- Never hand-copy a fact the API already states. `check-description-drift.mjs` derives the
  canonical terminal reasons from the live `openapi.json`; that is the pattern for anything where
  two places must agree.
- Carry the CH-Api#52 rule wherever verification is described: `pending` is a deadline that has not
  passed and is not a failure, `unknown` is an absence of record, only `overdue` is a missed
  deadline, and non-individual nodes carry none of the fields.
- `endpoint-drift.yml` runs all three checkers weekly and opens one issue when any drifts. Add new
  checkers there, with `set -o pipefail` - without it a teed step reports success on failure.

## Where the detail lives

| Question | Read |
|---|---|
| API surface, endpoints, response shapes | `registrum-landscape` -> the API reference |
| npm/OIDC, Glama, Smithery, registry config | `registrum-landscape` -> `references/internal-systems.md` |
| Cross-project platform traps | `platform-traps` |
