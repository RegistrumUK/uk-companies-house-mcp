import { describe, it, expect } from "vitest";
import { resolveApiKey } from "./key.js";

/**
 * Production auth_failures, 26 Oct - 17 Nov 2026: this package sent the
 * literal string "${REGISTRUM_API_KEY}" as the key on 12 real tool calls
 * (search, bundle, psc/chain, financials) across 2.1.2-2.1.5, and
 * "[object Object]" 158 times. Some installer wrote an unexpanded placeholder
 * into the client config. A non-empty placeholder skipped the keyless relay,
 * so every call 401'd "Invalid API key" and the user saw nothing but errors.
 *
 * The API only ever accepts reg_ keys, so anything else is guaranteed to
 * fail: relaying it to the keyless endpoint instead can only help.
 */
describe("resolveApiKey", () => {
  it("accepts a real key", () => {
    const key = "reg_live_" + "a1".repeat(16);
    expect(resolveApiKey(key)).toEqual({ key, ignored: null });
  });

  it("trims surrounding whitespace from a real key", () => {
    const key = "reg_live_" + "b2".repeat(16);
    expect(resolveApiKey(`  ${key}\n`).key).toBe(key);
  });

  it("treats unset or blank as no key, without calling it ignored", () => {
    expect(resolveApiKey(undefined)).toEqual({ key: "", ignored: null });
    expect(resolveApiKey("   ")).toEqual({ key: "", ignored: null });
  });

  it.each([
    "${REGISTRUM_API_KEY}",
    "${env:REGISTRUM_API_KEY}",
    "{{REGISTRUM_API_KEY}}",
    "$REGISTRUM_API_KEY",
    "<your-api-key>",
    "[object Object]",
    "reg_live_...",
    "undefined",
    "your_api_key_here",
  ])("ignores the placeholder %s and falls back to keyless", (raw) => {
    expect(resolveApiKey(raw)).toEqual({ key: "", ignored: raw });
  });
});
