#!/usr/bin/env node
// =============================================================================
// publish-immo-served-ids.mjs — build the IMMO leg's served canonical_id artefact.
//
// Runs at the END of the immo bascule (after smoke S7), 0 cred: enumerate immo's
// served entities as RAW refs and build the served canonical_id set by CONSUMING
// @sentropic/geo `buildServedCanonicalIds` (re-canonicalizes RAW `code_zone` /
// `no_lot` via the single-source canonicalizers — dossier §9(a): byte-identical
// to geo's served set BY CONSTRUCTION). Emits:
//   <out>                 the byte-sorted, newline-terminated served-ids blob,
//   <out>.sha256          its sha256 (sealed value, matches geo.json s3_servi).
// The immo workflow uploads <out> as artefact `immo-served-canonical-ids-<CYCLE_ID>`.
//
// RAW REFS SOURCE — PENDING (O1 source-gap, SPEC §7): the exact immo PUBLIC
// preprod endpoint that enumerates served entities as RAW {citySlug, code_zone} /
// {citySlug, no_lot} is not yet arrested. This tool takes the raw set from a
// documented, configurable source (a local JSON file or an HTTP endpoint) rather
// than guessing an endpoint. Required raw shape:
//   { "lots":  [ { "citySlug": "montreal", "noLot": "1 234 567" }, ... ],
//     "zones": [ { "citySlug": "montreal", "zoneCode": "C408" }, ... ] }
// =============================================================================
import console from "node:console";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { loadGeo } from "./geo-loader.mjs";
import { buildServedIds } from "./served-canonical-ids.mjs";

const die = (m) => { console.log(`::error title=publish-immo-served-ids::${m}`); process.exit(1); };
const opt = (n, d) => { const v = process.env[n]; return v === undefined || v === "" ? d : v; };

// Load the RAW served refs from the configured source (file or URL). PENDING: the
// canonical immo public preprod endpoint (O1). Fail-closed if unconfigured.
async function loadRawRefs() {
  const file = opt("IMMO_SERVED_REFS_FILE", "");
  const url = opt("IMMO_SERVED_REFS_URL", "");
  if (file) return JSON.parse(await readFile(file, "utf8"));
  if (url) {
    const res = await globalThis.fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) die(`raw refs URL ${url} → HTTP ${res.status}`);
    return res.json();
  }
  die(
    "no raw refs source configured. Set IMMO_SERVED_REFS_FILE=<path> or IMMO_SERVED_REFS_URL=<immo preprod public endpoint>. " +
      "PENDING (O1): the exact immo preprod served-entities endpoint (RAW code_zone / no_lot enumeration) is not yet arrested.",
  );
  return undefined; // unreachable (die exits)
}

function normalizeRefs(raw) {
  const lots = Array.isArray(raw && raw.lots) ? raw.lots.map((r) => ({ citySlug: r.citySlug, noLot: r.noLot })) : [];
  const zones = Array.isArray(raw && raw.zones) ? raw.zones.map((r) => ({ citySlug: r.citySlug, zoneCode: r.zoneCode })) : [];
  return { lots, zones };
}

async function main() {
  const cycleId = opt("CYCLE_ID", "");
  const out = opt("IMMO_SERVED_IDS_OUT", "immo-served-canonical-ids.txt");
  if (!cycleId) die("CYCLE_ID is required (the artefact name is immo-served-canonical-ids-<CYCLE_ID>).");
  const geo = await loadGeo();
  console.log(`[publish-immo] @sentropic/geo@${geo.version} loaded (buildServedCanonicalIds).`);
  const refs = normalizeRefs(await loadRawRefs());
  const { text, sha256, count } = buildServedIds(geo, refs);
  writeFileSync(out, text, { mode: 0o644 });
  writeFileSync(`${out}.sha256`, `${sha256}  ${out}\n`, { mode: 0o644 });
  console.log(`[publish-immo] CYCLE_ID=${cycleId} served_ids=${count} sha256=${sha256} → ${out}`);
}

main().catch((e) => die(e && e.message ? e.message : String(e)));
