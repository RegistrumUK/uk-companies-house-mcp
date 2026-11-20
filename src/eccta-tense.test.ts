import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ECCTA enforcement began on 2026-11-18; tool descriptions must not say it "begins" (website#245).
describe("ECCTA enforcement copy is not future tense", () => {
  it("server.ts has no future-tense enforcement phrasing", () => {
    const src = readFileSync(new URL("./server.ts", import.meta.url), "utf8").replace(/"\s*\+\s*\n\s*"/g, "");
    expect(src).not.toMatch(/enforcement (of the regime )?begins/i);
    expect(src).not.toMatch(/will begin|before 18 November 2026/i);
  });
});
