#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createServer } from "./server.js";
import { relay } from "./relay.js";
import { resolveApiKey } from "./key.js";
import { TRIAL_DAYS } from "./trial.js";
import { USER_AGENT } from "./version.js";

const HOSTED_ENDPOINT = "https://registrum.co.uk/api/mcp";

const { key: apiKey, ignored } = resolveApiKey(process.env.REGISTRUM_API_KEY);
if (!apiKey) {
  // No key used to mean every tool call failed (#61). Now it means the hosted
  // keyless endpoint answers instead: same tools, anonymous daily caps. A
  // placeholder value counts as no key - see key.ts.
  const why = ignored
    ? `REGISTRUM_API_KEY is set to "${ignored.slice(0, 40)}", which is not a Registrum key (they start with reg_live_). Ignoring it`
    : "REGISTRUM_API_KEY is not set";
  process.stderr.write(
    `${why}: relaying to the keyless hosted endpoint https://registrum.co.uk/api/mcp (daily caps apply).\n` +
    `Free key (${TRIAL_DAYS} days of full access, no card): https://registrum.co.uk/?utm_source=mcp&utm_campaign=server\n`
  );
  await relay(
    new StdioServerTransport(),
    new StreamableHTTPClientTransport(new URL(HOSTED_ENDPOINT), {
      requestInit: { headers: { "User-Agent": USER_AGENT } },
    })
  );
} else {
  // A factory rather than a single instance: serveStdio builds one server per
  // connection, and pins it to the protocol era the client handshook with, so
  // the same tool definitions serve both 2025-era and 2026-07-28 clients.
  serveStdio(() => createServer(apiKey));
}
