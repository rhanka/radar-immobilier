// =============================================================================
// join-verify.mjs — the "JOIN-VERIFY RENDEZVOUS" seam (pluggable, typed).
//
// LOCKED contract (coordinator 2026-09-25, point 3):
//   Each leg publishes, at the END of its bascule (after smoke S7, 0 cred, from
//   the tenant's PUBLIC preprod API, via @sentropic/geo buildServedCanonicalIds),
//   a byte-sorted (LC_ALL=C) served-ids file + its sha256, as a GitHub artefact:
//       immo → `immo-served-canonical-ids-<CYCLE_ID>`
//       geo  → `geo-served-canonical-ids-<CYCLE_ID>`
//   The orchestrator DOWNLOADS both and compares OCTET-À-OCTET (byteCompare):
//   status = match | drift. On drift → redo-on-drift per SPEC §5.
//
// The seam stays pluggable: `InertRendezvous` is the documented default (fails
// closed on use); `GithubArtifactRendezvous` is the wired impl. The exact file
// NAME inside each artefact is still PENDING geo-cond confirmation (see README).
// =============================================================================
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { byteCompare, sha256Hex } from "./served-canonical-ids.mjs";
import { LEG_DEFAULTS, resolveLegToken } from "./dispatch.mjs";

/**
 * @typedef {Object} ServedIds
 * @property {string} text      the served-ids blob (byte-sorted, newline-terminated)
 * @property {string} sha256    sha256 of `text`
 * @property {string} source    provenance (artefact id / url) for the audit trail
 *
 * @typedef {Object} ServedIdsRendezvous
 * @property {(q: { tenant: "immo"|"geo", cycleId: string, runId: number }) => Promise<ServedIds>} fetchServedIds
 */

// Locked artefact naming (coordinator point 3).
export function servedIdsArtifactName(tenant, cycleId) {
  return `${tenant}-served-canonical-ids-${cycleId}`;
}

// ── Inert default (documented, fails closed on use) ──────────────────────────
export class InertRendezvous {
  constructor(reason = "no rendezvous configured") {
    this.reason = reason;
  }
  async fetchServedIds() {
    throw new Error(`InertRendezvous.fetchServedIds: ${this.reason}. Configure GithubArtifactRendezvous (BASCULE2_RENDEZVOUS_MODE=github).`);
  }
}

// ── Wired impl: GitHub artefact download + native unzip ──────────────────────
export class GithubArtifactRendezvous {
  /**
   * @param {{ env?: Record<string,string>, legs?: typeof LEG_DEFAULTS, workdir?: string, fetchImpl?: typeof fetch }} [opts]
   */
  constructor({ env = process.env, legs = LEG_DEFAULTS, workdir, fetchImpl } = {}) {
    this.env = env;
    this.legs = legs;
    this.workdir = workdir || join(process.cwd(), ".bascule2-work");
    this.fetch = fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== "function") throw new Error("GithubArtifactRendezvous: global fetch unavailable (Node >= 18 required).");
  }

  _headers(tenant) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${resolveLegToken(this.env, tenant)}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bascule-2tenants-orchestrator",
    };
  }

  async fetchServedIds({ tenant, cycleId, runId }) {
    const leg = this.legs[tenant];
    const wantName = servedIdsArtifactName(tenant, cycleId);
    // 1) locate the artefact by name on the leg run.
    const listUrl = `https://api.github.com/repos/${leg.repo}/actions/runs/${runId}/artifacts?per_page=100`;
    const listRes = await this.fetch(listUrl, { headers: this._headers(tenant) });
    if (!listRes.ok) throw new Error(`fetchServedIds(${tenant}): list HTTP ${listRes.status}`);
    const list = await listRes.json();
    const art = (list.artifacts || []).find((a) => a.name === wantName);
    if (!art) throw new Error(`fetchServedIds(${tenant}): artefact '${wantName}' not found on run ${runId}.`);
    // 2) download the zip (302 → follow) and extract the single served-ids file.
    const dlRes = await this.fetch(art.archive_download_url, { headers: this._headers(tenant) });
    if (!dlRes.ok) throw new Error(`fetchServedIds(${tenant}): download HTTP ${dlRes.status}`);
    mkdirSync(this.workdir, { recursive: true });
    const zipPath = join(this.workdir, `${wantName}.zip`);
    writeFileSync(zipPath, Buffer.from(await dlRes.arrayBuffer()), { mode: 0o600 });
    const text = unzipSingleFile(zipPath);
    return { text, sha256: sha256Hex(text), source: art.archive_download_url };
  }
}

// Extract the served-ids payload from a GitHub artefact zip using the native
// `unzip` binary (0 python, 0 new dependency). PENDING geo-cond: the exact file
// name inside the artefact — for now we require a SINGLE file and dump it.
export function unzipSingleFile(zipPath) {
  const list = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  if (list.status !== 0) throw new Error(`unzipSingleFile: cannot list ${zipPath} (${(list.stderr || "").trim()})`);
  const names = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (names.length !== 1) {
    throw new Error(`unzipSingleFile: expected exactly ONE file in ${zipPath}, got ${names.length} [${names.join(", ")}]. PENDING geo-cond: confirm the served-ids file name.`);
  }
  const cat = spawnSync("unzip", ["-p", zipPath, names[0]], { encoding: "utf8", maxBuffer: 1024 * 1024 * 128 });
  if (cat.status !== 0) throw new Error(`unzipSingleFile: cannot extract ${names[0]} from ${zipPath}`);
  return cat.stdout;
}

/**
 * High-level join-verify: fetch both legs' served-ids and compare byte-à-byte.
 * @param {{ rendezvous: ServedIdsRendezvous, cycleId: string, runIds: { immo: number, geo: number } }} args
 * @returns {Promise<{ status: "match"|"drift", diff_summary: object, immo: ServedIds, geo: ServedIds }>}
 */
export async function runJoinVerify({ rendezvous, cycleId, runIds }) {
  const immo = await rendezvous.fetchServedIds({ tenant: "immo", cycleId, runId: runIds.immo });
  const geo = await rendezvous.fetchServedIds({ tenant: "geo", cycleId, runId: runIds.geo });
  const cmp = byteCompare(immo.text, geo.text, { aLabel: "immo", bLabel: "geo" });
  return { status: cmp.status, diff_summary: cmp.diff_summary, immo, geo };
}

/**
 * Factory: default is the wired GitHub artefact rendezvous;
 * BASCULE2_RENDEZVOUS_MODE=inert selects the inert default.
 * @returns {ServedIdsRendezvous}
 */
export function makeRendezvous(env = process.env, { workdir, fetchImpl } = {}) {
  const mode = (env.BASCULE2_RENDEZVOUS_MODE || "github").toLowerCase();
  if (mode === "inert") return new InertRendezvous("BASCULE2_RENDEZVOUS_MODE=inert");
  return new GithubArtifactRendezvous({ env, workdir, fetchImpl });
}

// Read a locally-produced served-ids file (used by the orchestrator when a leg's
// artefact was already downloaded, or in tests). Trivial but centralises the read.
export function readServedIdsFile(path) {
  const text = readFileSync(path, "utf8");
  return { text, sha256: sha256Hex(text), source: path };
}
