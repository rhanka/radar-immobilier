// =============================================================================
// geo-loader.mjs — resolve and import @sentropic/geo@0.6.2 for the join-verify.
//
// The served canonical_id set MUST be built with the SINGLE-SOURCE canonicalizers
// of @sentropic/geo (dossier §9: immo's LOCAL normalizers diverge on zones — e.g.
// `C408` vs the served `C-408` — so the join is only byte-guaranteed when the
// SAME @sentropic/geo functions produce both sides). immo pins @sentropic/geo at
// ^0.6.2 in api/package.json; that copy is nested under `api/node_modules` when
// the monorepo also holds the older 0.1.x pulled transitively by
// @sentropic/geo-sources-americas.
//
// @sentropic/geo is ESM-ONLY with an `import`-only `exports` map (no `require`,
// no `./package.json` subpath), so `require.resolve` / `import.meta.resolve`
// cannot resolve it from a repo-root CI script. We therefore locate the package
// directory by walking node_modules from the api anchor and import its ESM entry
// directly. The four join-verify symbols are all re-exported from the root entry.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED = Object.freeze([
  "buildServedCanonicalIds",
  "serializeServedCanonicalIds",
  "canonicalizeZoneCodeForJoin",
  "canonicalizeNoLotForJoin",
]);

// api/ directory (the anchor): geo resolves to the version api pins (0.6.2).
function apiDir() {
  return fileURLToPath(new URL("../../../api/", import.meta.url));
}

// Walk up from `startDir` to the first node_modules/@sentropic/geo/package.json.
function findGeoPkgDir(startDir) {
  let dir = startDir.replace(/\/+$/, "");
  for (;;) {
    const cand = join(dir, "node_modules", "@sentropic", "geo", "package.json");
    if (existsSync(cand)) return dirname(cand);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function entryFromExports(pkg) {
  const e = pkg && pkg.exports && pkg.exports["."];
  if (e && typeof e === "object" && e.import) return e.import;
  return pkg.module || pkg.main || "index.js";
}

function versionAtLeast(version, major, minor) {
  const [ma, mi] = String(version).split(".").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(ma)) return false;
  return ma > major || (ma === major && mi >= minor);
}

/**
 * Load the four join-verify symbols from @sentropic/geo@>=0.6.2, resolved through
 * the api package. Fail-closed with an actionable message if the resolved copy is
 * too old (missing the served-ids builder) — that means api's pin was not bumped
 * or node_modules is stale.
 * @returns {Promise<{
 *   version: string,
 *   buildServedCanonicalIds: (input: {zones?: Iterable<{citySlug: string, zoneCode: unknown}>, lots?: Iterable<{citySlug: string, noLot: unknown}>}) => string[],
 *   serializeServedCanonicalIds: (ids: readonly string[]) => string,
 *   canonicalizeZoneCodeForJoin: (value: unknown) => string,
 *   canonicalizeNoLotForJoin: (value: unknown) => string,
 * }>}
 */
export async function loadGeo() {
  const pkgDir = findGeoPkgDir(apiDir());
  if (!pkgDir) {
    throw new Error(
      "geo-loader: cannot locate @sentropic/geo under api/node_modules. " +
        "Run 'npm install' at the repo root and confirm api/package.json pins @sentropic/geo ^0.6.2.",
    );
  }
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const version = pkg.version || "unknown";
  const entryUrl = pathToFileURL(join(pkgDir, entryFromExports(pkg)));
  const mod = await import(entryUrl.href);
  const missing = REQUIRED.filter((k) => typeof mod[k] !== "function");
  if (missing.length) {
    throw new Error(
      `geo-loader: resolved @sentropic/geo@${version} (${pkgDir}) is missing join-verify symbols [${missing.join(", ")}]. ` +
        "The served-ids builder needs @sentropic/geo >= 0.6.2 (api pin). Bump api/package.json and reinstall.",
    );
  }
  if (!versionAtLeast(version, 0, 6)) {
    throw new Error(`geo-loader: @sentropic/geo@${version} is older than the required 0.6.2 (api pin drifted).`);
  }
  return {
    version,
    buildServedCanonicalIds: mod.buildServedCanonicalIds,
    serializeServedCanonicalIds: mod.serializeServedCanonicalIds,
    canonicalizeZoneCodeForJoin: mod.canonicalizeZoneCodeForJoin,
    canonicalizeNoLotForJoin: mod.canonicalizeNoLotForJoin,
  };
}
