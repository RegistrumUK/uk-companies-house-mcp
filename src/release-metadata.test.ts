import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The MCP registry publishes from server.json, npm publishes from package.json.
 * Nothing kept them in step, so the registry sat at v1.0.2 while npm was at
 * v1.2.0 - anyone discovering us through the official registry got a pointer
 * two minor versions behind for five months (CH-Api#75).
 *
 * `prepublishOnly` runs this suite, so a mismatch now blocks the publish that
 * would create it.
 */
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
const server = JSON.parse(readFileSync(path.join(root, "server.json"), "utf-8"));

describe("release metadata stays in step", () => {
  it("server.json version matches package.json", () => {
    expect(server.version).toBe(pkg.version);
  });

  it("package.json mcpName matches the registry server name", () => {
    // The registry validates the published tarball against this. A mismatch
    // fails the publish with "Registry validation failed for package".
    expect(pkg.mcpName).toBe(server.name);
  });

  it("package.json repository matches server.json, and the real repo", () => {
    // Trusted publishing signs a provenance statement naming the repo the build
    // actually ran in. If package.json disagrees, npm rejects the publish with
    // E422 "Failed to validate repository information". package.json carried a
    // stale username (eugenemerwe) long after the repo moved to vdmeu.
    const normalise = (u: string) =>
      u.replace(/^git\+/, "").replace(/\.git$/, "").toLowerCase();
    expect(normalise(pkg.repository.url)).toBe(normalise(server.repository.url));
    expect(normalise(pkg.repository.url)).toBe("https://github.com/RegistrumUK/uk-companies-house-mcp".toLowerCase());
  });

  it("the npm package entry inside server.json matches too", () => {
    const npmPkg = server.packages.find(
      (p: { registryType: string }) => p.registryType === "npm"
    );
    expect(npmPkg).toBeDefined();
    expect(npmPkg.identifier).toBe(pkg.name);
    expect(npmPkg.version).toBe(pkg.version);
  });
});

/**
 * Attribution (CH-Api#76). This package is the only developer channel with
 * measurable pull - 210 npm downloads in the month to 2026-08-03 - yet every
 * route it offered to sign up was untagged, so not one of those downloads could
 * ever be connected to a signup. api_keys.utm_source was NULL on all 41 rows.
 */
describe("signup links are attributable", () => {
  const sources = {
    "src/index.ts": readFileSync(path.join(root, "src/index.ts"), "utf-8"),
    "src/server.ts": readFileSync(path.join(root, "src/server.ts"), "utf-8"),
    "README.md": readFileSync(path.join(root, "README.md"), "utf-8"),
  };

  for (const [file, content] of Object.entries(sources)) {
    it(`${file} tags every registrum.co.uk signup link with utm_source=mcp`, () => {
      // Bare links to the site root are the ones that create signups; docs and
      // api subdomain links are not signup routes.
      const bare = content.match(/https:\/\/registrum\.co\.uk(?![a-z0-9./?=&-])/gi) ?? [];
      expect(
        bare,
        `${file} has an untagged signup link - it must carry ?utm_source=mcp`
      ).toHaveLength(0);
    });
  }

  it("server.json's key-acquisition hint is tagged too", () => {
    const npmPkg = server.packages.find(
      (p: { registryType: string }) => p.registryType === "npm"
    );
    const env = npmPkg.environmentVariables.find(
      (e: { name: string }) => e.name === "REGISTRUM_API_KEY"
    );
    expect(env.description).toContain("utm_source=mcp");
  });
});

/**
 * Per Eugene, 2026-08-05: "all new features need to show here". The API grew
 * /compliance (the ECCTA differentiator, hard 18 Nov 2026 deadline) and
 * /kyb-report, and neither reached this package - developers discovering us
 * through MCP simply could not see them.
 *
 * These guards make that mechanical rather than remembered.
 */
describe("the package reflects what the API can actually do", () => {
  const serverSrc = readFileSync(path.join(root, "src/server.ts"), "utf-8");

  it("reports its real version to MCP clients, not a hardcoded one", () => {
    // VERSION sat at "1.0.0" while the package shipped 1.2.1, so every client
    // was told the wrong version - the same silent drift as server.json.
    const hardcoded = serverSrc.match(/const VERSION\s*=\s*["']([\d.]+)["']/);
    expect(
      hardcoded,
      "VERSION must be derived from package.json, not written as a literal"
    ).toBeNull();
  });

  it("identifies itself with a User-Agent so its usage is attributable", () => {
    // Without this the API cannot distinguish MCP-driven calls from direct
    // ones, which is why MCP adoption was invisible despite 210 downloads/mo.
    expect(serverSrc).toMatch(/["']User-Agent["']\s*:/);
  });

  it("exposes a tool for every company endpoint the API offers", () => {
    // Endpoints deliberately not surfaced go here, with a reason - so a
    // decision to omit is explicit rather than an oversight.
    const waived: Record<string, string> = {
      "kyb-report": "composite report; the underlying endpoints are each exposed",
    };
    const apiEndpoints = ["compliance", "directors", "financials", "network", "psc", "psc/chain"];
    const missing = apiEndpoints.filter((e) => {
      if (waived[e]) return false;
      const slug = e.replace("/", "_");
      return !serverSrc.includes(`"get_${slug}"`);
    });
    expect(
      missing,
      `API endpoints with no MCP tool: ${missing.join(", ")}. Add a tool, or waive it with a reason.`
    ).toEqual([]);
  });
});

/**
 * Registry-side limits that are only discoverable by failing a publish.
 *
 * The MCP registry rejects a server.json whose `description` exceeds 100
 * characters with a 422, and it does so *after* `npm publish` has already
 * succeeded in the same workflow job. So the cost of getting this wrong is not
 * a retry - it is a burnt npm version number, because npm refuses to republish
 * one. Caught for real on 2.0.1 (2026-08-07).
 */
describe("server.json satisfies MCP registry validation", () => {
  const server = JSON.parse(readFileSync(path.join(root, "server.json"), "utf-8"));

  it("description is within the registry's 100-character limit", () => {
    expect(
      server.description.length,
      `description is ${server.description.length} chars; the registry 422s above 100, ` +
        `and by then npm has already consumed the version number`
    ).toBeLessThanOrEqual(100);
  });

  // Developers search directories for the register, not for our brand: on
  // 2026-10-08 the official registry's search for "companies" listed five
  // competitors titled "UK Companies House" and not us, because we had no title
  // and our name contains neither word. The brand stays in the identifier.
  it("leads every display field with the words developers search for", () => {
    expect(server.title).toMatch(/^UK Companies House\b/);
    expect(server.title.length).toBeLessThanOrEqual(100);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
    expect(pkg.description).toMatch(/^UK Companies House\b/);
  });

  it("advertises the hosted endpoint as a remote", () => {
    const urls = (server.remotes ?? []).map((r: { url: string }) => r.url);
    expect(urls).toContain("https://registrum.co.uk/api/mcp");
  });

  it("does not mark the API key as required, now that anonymous access exists", () => {
    for (const pkg of server.packages ?? []) {
      for (const env of pkg.environmentVariables ?? []) {
        expect(env.isRequired, `${env.name} must not be required`).toBeFalsy();
      }
    }
  });
});

/**
 * Declared dependency floors, not just the lockfile (#14, #7).
 *
 * The MCP Marketplace scanner reads `package.json` from the GitHub repo and
 * resolves each declared range *statically*. Its scan of 2.0.4 listed exactly
 * `README.md`, `package.json` and `src/*.ts` as scanned_files - no
 * `package-lock.json`. With no lockfile it can only assume the lowest version a
 * range admits, so `"vitest": "^3"` reads to it as vitest 3.0.0.
 *
 * That is why the 2026-08-08 audit (a68d675) only half-worked. `npm audit fix`
 * moved the *lockfile* to vitest 3.2.7 and `npm audit` has reported 0
 * vulnerabilities ever since - but the declared range stayed `^3`, whose floor
 * of 3.0.0 is still inside both advisories. esbuild cleared in the same commit
 * precisely because its range was bumped explicitly to `^0.28.1`, putting its
 * floor on the patched version. Result: the public listing kept showing 2
 * critical vitest findings, and the score stuck at 5.2 "Moderate Risk".
 *
 * So the floor a range admits is a published trust signal in its own right.
 * Loosening one of these back to a bare major silently re-opens the finding.
 */
describe("dependency ranges declare an advisory-clean floor", () => {
  /** Lowest version a simple npm range admits (`^`/`~`/`>=`/exact). */
  const minVersion = (range: string): number[] => {
    const bare = range.replace(/^[\^~]|^>=\s*/, "").trim();
    const parts = bare.split(".").map((p) => parseInt(p, 10));
    while (parts.length < 3) parts.push(0); // "^3" admits 3.0.0
    return parts;
  };

  const gte = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return true;
  };

  // Package -> lowest version with no known advisory against it, and why.
  const safeFloors: Record<string, { floor: string; because: string }> = {
    vitest: {
      floor: "3.2.6",
      because:
        "GHSA-9crc-q9x8-hgqq (CVE-2025-24964, RCE via the API server) is patched " +
        "in 3.0.5 and GHSA-5xrq-8626-4rwp (CVE-2026-47429, arbitrary file " +
        "read/execute via the UI server) in 3.2.6 - both critical",
    },
    esbuild: {
      floor: "0.28.1",
      because:
        "GHSA-g7r4-m6w7-qqqr (arbitrary file read via the Windows dev server) " +
        "and GHSA-gv7w-rqvm-qjhr are both patched in 0.28.1",
    },
  };

  const declared: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  for (const [name, { floor, because }] of Object.entries(safeFloors)) {
    it(`${name} cannot be declared below ${floor}`, () => {
      const range = declared[name];
      expect(range, `${name} is no longer a declared dependency`).toBeDefined();
      expect(
        gte(minVersion(range), minVersion(floor)),
        `package.json declares "${name}": "${range}", which admits ` +
          `${minVersion(range).join(".")}. A scanner that reads only package.json ` +
          `resolves the range to that floor and reports the advisory as unfixed. ` +
          `Declare ^${floor} or higher: ${because}.`
      ).toBe(true);
    });
  }

  it("server.json carries the brand icons, all https on registrum.co.uk/brand/", () => {
    expect(Array.isArray(server.icons)).toBe(true);
    const srcs = server.icons.map((i: { src: string }) => i.src);
    expect(srcs).toContain("https://registrum.co.uk/brand/icon-512.png");
    expect(srcs).toContain("https://registrum.co.uk/brand/icon-192.png");
    expect(srcs).toContain("https://registrum.co.uk/brand/app-icon.svg");
    for (const i of server.icons) {
      expect(i.src).toMatch(/^https:\/\/registrum\.co\.uk\/brand\//);
      expect(i.mimeType).toMatch(/^image\//);
      expect(Array.isArray(i.sizes)).toBe(true);
    }
  });

  it("server.json icons match the SERVER_ICONS the server advertises", async () => {
    const { SERVER_ICONS } = await import("./server.js");
    expect(SERVER_ICONS).toEqual(server.icons);
  });
});
