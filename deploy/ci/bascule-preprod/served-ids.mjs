#!/usr/bin/env node
// =============================================================================
// served-ids.mjs — immo side of the e2e immo+geo contract (CYCLE_ID). 0 python.
//
// The e2e orchestrator (deploy/ci/bascule-2tenants, workflow bascule-e2e.yml)
// dispatches bascule-preprod.yml with CYCLE_ID, then checks by INCLUSION that
// every canonical id immo references exists, byte for byte, in geo's served set.
// This script carries the immo half of that contract; it runs in two jobs of
// bascule-preprod.yml that hold NO cluster credential (kubeconfigs stay in the
// `bascule` job):
//
//   build        job `served-ids` (needs bascule, non-DRY, CYCLE_ID set): reads
//                the RAW zone refs immo references (IMMO_SERVED_REFS_URL — public
//                preprod endpoint, 0 credential — or IMMO_SERVED_REFS_FILE) and
//                computes the ids with the PUBLISHED builder
//                @sentropic/geo@<BUILDER_VERSION> (installed outside the workspace,
//                exactly like the geo leg: same builder on both sides ⇒ byte-
//                identical canonicalisation by construction). Artefact files (same
//                layout as geo's geo-served-canonical-ids-<CYCLE_ID>):
//                  served-ids.txt         1 id per line, byte order, deduplicated
//                  served-ids.txt.sha256  `<hex>  served-ids.txt` (sha256sum -c)
//                  served-ids.meta.json   counts, scope, builder, source
//                SCOPE = ZONES (zones first, arbitration i-cond 2026-09-25; geo serves
//                zones only for now). PENDING O1: the immo endpoint enumerating the
//                referenced RAW zone codes is not delivered yet → fail-closed.
//   cycle-leg    job `cycle-leg` (needs [bascule, served-ids], always): writes
//                `legs.immo` (run, sha, MODE, backup date + sha256, verdict pg/s3).
//   validate-cycle-id / builder-version  small helpers for the workflow.
// =============================================================================
import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CYCLE_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
export const BUILDER_PACKAGE = "@sentropic/geo";
export const BUILDER_VERSION = "0.6.2"; // same pin as the geo leg (rhanka/geo served-ids.mjs)
export const SERVED_IDS_SCOPE = "zones";
export const IDS_FILE = "served-ids.txt";
export const SHA_FILE = `${IDS_FILE}.sha256`;
export const META_FILE = "served-ids.meta.json";
export const LEG_REPO = "rhanka/radar-immobilier";
export const LEG_WORKFLOW = "bascule-preprod.yml";
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

const log = (m) => console.log(`[served-ids] ${m}`);
const die = (m) => {
  console.log(`::error title=served-ids failed::${m}`);
  process.exit(1);
};

// ── pure helpers ─────────────────────────────────────────────────────────────
export function isValidCycleId(v) { return typeof v === "string" && CYCLE_ID_PATTERN.test(v); }
export function servedIdsArtifactName(cycleId) {
  if (!isValidCycleId(cycleId)) throw new Error("invalid CYCLE_ID");
  return `immo-served-canonical-ids-${cycleId}`;
}
export function cycleLegArtifactName(cycleId) {
  if (!isValidCycleId(cycleId)) throw new Error("invalid CYCLE_ID");
  return `cycle-leg-immo-${cycleId}`;
}
export function byteCompare(a, b) { return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")); }
export function sha256Hex(data) { return createHash("sha256").update(data).digest("hex"); }
export function sha256FileLine(hex, name = IDS_FILE) {
  if (!SHA_RE.test(hex)) throw new Error("invalid sha256");
  return `${hex}  ${name}\n`;
}
export function parseSha256File(text) {
  const m = /^([a-f0-9]{64})(?:\s+\*?\S.*)?$/.exec(String(text ?? "").split("\n")[0].trim());
  if (!m) throw new Error("unreadable .sha256 file");
  return m[1];
}

// RAW refs → zones input of the builder. Only `zones` (scope); lots are ignored
// until geo serves lots (reported in the meta).
export function normalizeRawRefs(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.zones)) throw new Error("raw refs must be { zones: [{ citySlug, zoneCode }] }");
  const zones = [];
  let dropped = 0;
  for (const r of raw.zones) {
    if (!r || typeof r.citySlug !== "string" || !SLUG_RE.test(r.citySlug)) throw new Error("raw zone ref with an invalid citySlug");
    if (r.zoneCode === null || r.zoneCode === undefined || String(r.zoneCode).trim() === "") { dropped += 1; continue; }
    zones.push({ citySlug: r.citySlug, zoneCode: r.zoneCode });
  }
  return { zones, dropped, lotsIgnored: Array.isArray(raw.lots) ? raw.lots.length : 0 };
}

// Output guard: non-empty, `ogc:zones:<slug>:<code>`, strictly increasing byte order.
export function assertServedZoneIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("empty result: no zone id (fail-closed)");
  const shape = /^ogc:zones:[a-z0-9][a-z0-9-]*:\S+$/;
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== "string" || !shape.test(ids[i])) throw new Error(`id out of format at index ${i}`);
    if (i > 0 && byteCompare(ids[i - 1], ids[i]) >= 0) throw new Error(`ids not strictly byte-ordered at index ${i}`);
  }
}

export function mapOutcome(o) {
  switch (String(o ?? "").trim()) {
    case "success": return "success";
    case "failure": case "cancelled": case "skipped": return "failure";
    default: return "pending";
  }
}
export function combine(outcomes) {
  const v = outcomes.map(mapOutcome);
  if (v.includes("failure")) return "failure";
  if (v.length && v.every((x) => x === "success")) return "success";
  return "pending";
}

// legs.immo verdict from the step outcomes of the `bascule` job.
export function immoVerdict(mode, o) {
  if (mode === "restore") {
    return { pg: combine([o.restoreBackup, o.migrate]), s3: combine([o.docsBackup, o.reconBackup, o.smoke]) };
  }
  return { pg: combine([o.dump, o.restoreChain, o.migrate]), s3: combine([o.docsChain, o.reconChain, o.smoke]) };
}

export function buildImmoLeg({ cycleId, runId, gitSha, repo = LEG_REPO, mode, backup, outcomes, servedIdsSha256 }) {
  if (!/^\d+$/.test(String(runId ?? ""))) throw new Error("invalid run_id");
  const sha = String(gitSha ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("invalid commit sha");
  if (servedIdsSha256 !== null && servedIdsSha256 !== undefined && !SHA_RE.test(servedIdsSha256)) throw new Error("invalid served_ids_sha256");
  if (!["chain", "restore"].includes(mode)) throw new Error("invalid MODE for a cycle leg");
  let b = null;
  if (mode === "restore" && backup && DATE_RE.test(String(backup.date ?? ""))) {
    b = {
      id: backup.id === "latest" || DATE_RE.test(String(backup.id ?? "")) ? backup.id : null,
      date: backup.date,
      manifest_sha256: SHA_RE.test(String(backup.manifestSha256 ?? "")) ? backup.manifestSha256 : null,
      pg_sha256: SHA_RE.test(String(backup.pgSha256 ?? "")) ? backup.pgSha256 : null,
      dump_started_at: Number.isFinite(Date.parse(backup.dumpStartedAt)) ? new Date(Date.parse(backup.dumpStartedAt)).toISOString() : null,
    };
  }
  return {
    repo,
    workflow: LEG_WORKFLOW,
    run_id: String(runId),
    sha_main: sha.slice(0, 7),
    // coherence point of the leg: the backup dump start (MODE=restore); null in chain mode.
    t1: b ? b.dump_started_at : null,
    mode,
    backup: b,
    verdict: immoVerdict(mode, outcomes || {}),
    served_ids_artifact: servedIdsArtifactName(cycleId),
    served_ids_sha256: servedIdsSha256 ?? null,
    served_ids_scope: SERVED_IDS_SCOPE,
  };
}

export function readServedIdsSha(dir) {
  const shaPath = join(dir, SHA_FILE);
  const idsPath = join(dir, IDS_FILE);
  if (!existsSync(shaPath) && !existsSync(idsPath)) return null;
  if (!existsSync(shaPath) || !existsSync(idsPath)) throw new Error(`incomplete served-ids artefact in ${dir}`);
  const declared = parseSha256File(readFileSync(shaPath, "utf8"));
  const actual = sha256Hex(readFileSync(idsPath));
  if (declared !== actual) throw new Error(`${SHA_FILE} differs from sha256(${IDS_FILE})`);
  return actual;
}

// ── published builder (installed outside the workspace) ─────────────────────
export function resolveBuilderEntry(builderDir, expected = BUILDER_VERSION) {
  const pkgDir = join(builderDir, "node_modules", "@sentropic", "geo");
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) throw new Error(`builder not found (${pkgPath}): npm install --prefix <dir> ${BUILDER_PACKAGE}@${expected}`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.name !== BUILDER_PACKAGE) throw new Error(`unexpected package ${pkg.name}`);
  if (pkg.version !== expected) throw new Error(`builder version ${pkg.version} != pinned ${expected}`);
  const entry = pkg.exports?.["."]?.import;
  if (typeof entry !== "string" || !entry) throw new Error(`${BUILDER_PACKAGE} has no exports["."].import`);
  return { entryPath: join(pkgDir, entry), version: pkg.version };
}
async function loadBuilder(builderDir) {
  const { entryPath, version } = resolveBuilderEntry(builderDir);
  const mod = await import(pathToFileURL(entryPath).href);
  if (typeof mod.buildServedCanonicalIds !== "function" || typeof mod.serializeServedCanonicalIds !== "function") {
    throw new Error(`${BUILDER_PACKAGE}@${version} does not export buildServedCanonicalIds/serializeServedCanonicalIds`);
  }
  return { build: mod.buildServedCanonicalIds, serialize: mod.serializeServedCanonicalIds, version };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const envOr = (n, d) => { const v = process.env[n]; return v === undefined || v === "" ? d : v; };

async function loadRawRefs() {
  const file = envOr("IMMO_SERVED_REFS_FILE", "");
  const url = envOr("IMMO_SERVED_REFS_URL", "");
  if (file) return { raw: JSON.parse(readFileSync(file, "utf8")), source: "file" };
  if (url) {
    if (!/^https:\/\//.test(url)) throw new Error("IMMO_SERVED_REFS_URL must be https");
    const res = await globalThis.fetch(url, { headers: { Accept: "application/json" }, signal: globalThis.AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`raw refs endpoint → HTTP ${res.status}`);
    return { raw: await res.json(), source: "url" };
  }
  throw new Error("no RAW refs source: set vars.BASCULE_IMMO_SERVED_REFS_URL (public immo preprod endpoint enumerating the " +
    "referenced RAW zone codes) — PENDING O1, endpoint not delivered yet (fail-closed)");
}

async function cmdBuild(argv) {
  const args = parseArgs(argv);
  if (!args["builder-dir"] || !args.out) die("usage: build --builder-dir <npm dir> --out <artefact dir>");
  const cycleId = envOr("CYCLE_ID", "");
  if (!isValidCycleId(cycleId)) die("invalid CYCLE_ID");
  let builder;
  try { builder = await loadBuilder(args["builder-dir"]); } catch (e) { die(`builder: ${e.message}`); }
  log(`builder ${BUILDER_PACKAGE}@${builder.version} (published, ${args["builder-dir"]})`);
  let refs; let source;
  try { const r = await loadRawRefs(); source = r.source; refs = normalizeRawRefs(r.raw); } catch (e) { die(`raw refs: ${e.message}`); }
  let ids; let text;
  try {
    ids = builder.build({ zones: refs.zones });
    assertServedZoneIds(ids);
    text = builder.serialize(ids);
    if (text !== `${ids.join("\n")}\n`) throw new Error("unexpected builder serialisation (1 id per line, final LF)");
  } catch (e) { die(`served ids: ${e.message}`); }
  const sha = sha256Hex(text);
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, IDS_FILE), text);
  writeFileSync(join(args.out, SHA_FILE), sha256FileLine(sha));
  const meta = {
    schema: "immo-served-canonical-ids-meta/v1", scope: SERVED_IDS_SCOPE, cycle_id: cycleId,
    generated_at: new Date().toISOString(), source,
    builder: { package: BUILDER_PACKAGE, version: builder.version, source: "npm (published)" },
    counts: { raw_zone_refs: refs.zones.length, raw_zone_refs_without_code: refs.dropped, lots_ignored: refs.lotsIgnored, ids: ids.length },
    ids_file: IDS_FILE, ids_sha256: sha,
  };
  writeFileSync(join(args.out, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  log(`OK — ${ids.length} zone ids (sha256 ${sha}) → ${args.out}`);
}

function cmdCycleLeg(argv) {
  const args = parseArgs(argv);
  if (!args.out) die("usage: cycle-leg --out <file> [--served-dir <dir>]");
  const cycleId = envOr("CYCLE_ID", "");
  if (!isValidCycleId(cycleId)) die("invalid CYCLE_ID");
  let servedSha = null;
  if (args["served-dir"]) {
    try { servedSha = readServedIdsSha(args["served-dir"]); } catch (e) { die(`served-ids artefact: ${e.message}`); }
  }
  let leg;
  try {
    leg = buildImmoLeg({
      cycleId,
      runId: envOr("GITHUB_RUN_ID", ""),
      gitSha: envOr("GITHUB_SHA", ""),
      repo: envOr("GITHUB_REPOSITORY", LEG_REPO),
      mode: envOr("MODE", "chain"),
      backup: {
        id: envOr("BACKUP_ID", ""), date: envOr("BACKUP_DATE", ""), manifestSha256: envOr("MANIFEST_SHA256", ""),
        pgSha256: envOr("PG_SHA256", ""), dumpStartedAt: envOr("DUMP_STARTED_AT", ""),
      },
      outcomes: {
        dump: envOr("O_DUMP", ""), restoreChain: envOr("O_RESTORE_CHAIN", ""), restoreBackup: envOr("O_RESTORE_BACKUP", ""),
        migrate: envOr("O_MIGRATE", ""), docsChain: envOr("O_DOCS_CHAIN", ""), reconChain: envOr("O_RECON_CHAIN", ""),
        docsBackup: envOr("O_DOCS_BACKUP", ""), reconBackup: envOr("O_RECON_BACKUP", ""), smoke: envOr("O_SMOKE", ""),
      },
      servedIdsSha256: servedSha,
    });
  } catch (e) { die(`legs.immo: ${e.message}`); }
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(leg, null, 2)}\n`);
  log(`legs.immo → ${args.out}`);
  console.log(JSON.stringify(leg, null, 2));
}

const COMMANDS = {
  "validate-cycle-id": () => {
    const v = envOr("CYCLE_ID", "");
    if (!isValidCycleId(v)) die(`CYCLE_ID invalid: expected ${CYCLE_ID_PATTERN} (nothing was run)`);
    log(`CYCLE_ID OK → ${servedIdsArtifactName(v)}, ${cycleLegArtifactName(v)}`);
  },
  "builder-version": () => console.log(BUILDER_VERSION),
  build: cmdBuild,
  "cycle-leg": cmdCycleLeg,
};

async function main() {
  const cmd = process.argv[2];
  if (!COMMANDS[cmd]) {
    console.log("usage: node served-ids.mjs <validate-cycle-id|builder-version|build|cycle-leg>");
    process.exit(cmd === "-h" || cmd === "--help" || !cmd ? 0 : 1);
  }
  await COMMANDS[cmd](process.argv.slice(3));
}

const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedDirectly) main().catch((e) => die(e?.message ?? String(e)));
