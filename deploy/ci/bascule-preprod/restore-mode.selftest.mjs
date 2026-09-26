#!/usr/bin/env node
// =============================================================================
// restore-mode.selftest.mjs — offline selftest of the bascule MODE=restore|list.
//
// 0 kubectl, 0 S3, 0 DB, 0 network. Covers:
//   - backup-restore.cjs (in-pod) pure functions + every step (resolve, list,
//     fetch-dump, docs, recon) against an in-memory VERSIONED S3 fake with one
//     client PER IDENTITY (reader / copy signer): a read through the wrong
//     identity is AccessDenied, so the test proves which identity does what;
//   - the script really runs under `node -e` (the way the Jobs embed it);
//   - restore-mode.mjs (runner) pure functions (PIN, listing, termination message);
//   - the three Job templates render with the embedded script (no leftover
//     placeholder, script recovered byte-identical; YAML parsed when the `yaml`
//     package is resolvable);
//   - the workflow wiring of bascule-preprod.yml (MODE, steps, conditions, no
//     input/secret interpolated in the new `run:` blocks);
//   - served-ids.mjs (legs.immo, verdict mapping, served-ids guards).
//
//   node deploy/ci/bascule-preprod/restore-mode.selftest.mjs   → exit 0 when all pass.
// =============================================================================
import { Buffer } from "node:buffer";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  assertScriptEmbeddable, assertYamlSafeVars, basculeMode, forbiddenDstBuckets, formatBackupTable, FROZEN_PROD_DOCS_BUCKETS, indentBlock, JOBS,
  parseTermination, pickTerminationMessage, podOfJob, safeReason, validateBackupIdInput, validateCycleId, validateListing, validatePin,
} from "./restore-mode.mjs";
import { buildFailureSummary } from "./bascule.mjs";
import {
  assertServedZoneIds, buildImmoLeg, combine, immoVerdict, mapOutcome, normalizeRawRefs, readServedIdsSha,
  servedIdsArtifactName, cycleLegArtifactName, sha256FileLine, refsFromTsv,
} from "./served-ids.mjs";
import { assembleRefs } from "./e2e-refs.mjs";
import {
  buildSecretManifest, DOCS_SYNC_SECRET_KEYS, redact, SECRET_SPECS, secretNameFor, secretValuesFromEnv, specsForMode, writePrivateManifest,
} from "./ci-secrets.mjs";

const require = createRequire(import.meta.url);
const br = require("./backup-restore.cjs");
const sr = require("./served-refs.cjs");
const DIR = import.meta.dirname;

let passed = 0;
let failed = 0;
const ok = (name, cond) => { if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}`); } };
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const throwsCode = (name, fn, code) => {
  try { fn(); ok(name, false); } catch (e) { ok(`${name} (exit ${e.exitCode})`, code === undefined ? true : e.exitCode === code); }
};
const throws = (name, fn) => { try { fn(); ok(name, false); } catch { ok(name, true); } };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const md5q = (b) => `"${createHash("md5").update(b).digest("hex")}"`;

// ═════════════════════════════ in-memory versioned S3 ═════════════════════════
class Cmd { constructor(input) { this.input = input; } }
const sdk = {};
for (const n of ["GetObjectCommand", "HeadObjectCommand", "ListObjectsV2Command", "ListObjectVersionsCommand", "CopyObjectCommand", "PutObjectCommand"]) {
  sdk[n] = { [n]: class extends Cmd {} }[n];
}
const denied = () => Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
const notFound = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });

class Store {
  constructor() { this.b = new Map(); this.seq = 0; this.copies = []; }
  put(bucket, key, body, lastModified) {
    if (!this.b.has(bucket)) this.b.set(bucket, new Map());
    const m = this.b.get(bucket);
    if (!m.has(key)) m.set(key, []);
    const buf = Buffer.from(body);
    const v = { VersionId: `v${++this.seq}`, body: buf, ETag: md5q(buf), Size: buf.length, LastModified: new Date(lastModified || "2026-09-26T03:00:00Z") };
    m.get(key).push(v);
    return v;
  }
  versions(bucket, key) { return (this.b.get(bucket) && this.b.get(bucket).get(key)) || []; }
  latest(bucket, key) { const v = this.versions(bucket, key); return v.length ? v[v.length - 1] : null; }
}
// policy: { read: ["bucket" | "bucket/prefix"], list: [buckets], listVersions: [buckets], write: [buckets] }
// (OVH: a read with versionId is a GetObject — no distinct GetObjectVersion right.)
function client(store, policy) {
  const can = (op, bucket, key) => (policy[op] || []).some((e) => e === bucket || (key !== undefined && e.includes("/") &&
    e.slice(0, e.indexOf("/")) === bucket && key.startsWith(e.slice(e.indexOf("/") + 1))));
  return {
    async send(cmd) {
      const i = cmd.input;
      if (cmd instanceof sdk.GetObjectCommand || cmd instanceof sdk.HeadObjectCommand) {
        if (!can("read", i.Bucket, i.Key)) throw denied();
        const v = i.VersionId ? store.versions(i.Bucket, i.Key).find((x) => x.VersionId === i.VersionId) : store.latest(i.Bucket, i.Key);
        if (!v) throw notFound();
        if (cmd instanceof sdk.HeadObjectCommand) return { ContentLength: v.Size, ETag: v.ETag, VersionId: v.VersionId };
        const body = v.body;
        return { VersionId: v.VersionId, Body: (async function* gen() { yield body.subarray(0, 7); yield body.subarray(7); })() };
      }
      if (cmd instanceof sdk.ListObjectsV2Command) {
        if (!can("list", i.Bucket)) throw denied();
        const m = store.b.get(i.Bucket) || new Map();
        const all = [...m.keys()].filter((k) => !i.Prefix || k.startsWith(i.Prefix)).sort()
          .map((k) => { const v = store.latest(i.Bucket, k); return { Key: k, Size: v.Size, ETag: v.ETag, LastModified: v.LastModified }; });
        const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0;
        const page = all.slice(start, start + 2);
        const more = start + 2 < all.length;
        return { Contents: page, IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined };
      }
      if (cmd instanceof sdk.ListObjectVersionsCommand) {
        if (!can("listVersions", i.Bucket)) throw denied();
        const m = store.b.get(i.Bucket) || new Map();
        const all = [];
        for (const k of [...m.keys()].filter((x) => !i.Prefix || x.startsWith(i.Prefix)).sort()) {
          const vs = m.get(k);
          vs.forEach((v, idx) => all.push({ Key: k, VersionId: v.VersionId, ETag: v.ETag, Size: v.Size, LastModified: v.LastModified, IsLatest: idx === vs.length - 1 }));
        }
        const start = i.KeyMarker ? Number(i.KeyMarker) : 0;
        const page = all.slice(start, start + 3);
        const more = start + 3 < all.length;
        return { Versions: page, DeleteMarkers: [], IsTruncated: more, NextKeyMarker: more ? String(start + 3) : undefined, NextVersionIdMarker: more ? "x" : undefined };
      }
      if (cmd instanceof sdk.CopyObjectCommand) {
        const m = /^\/([^/]+)\/(.+?)(?:\?versionId=(.+))?$/.exec(i.CopySource);
        const srcBucket = m[1]; const srcKey = decodeURIComponent(m[2]); const vid = m[3] ? decodeURIComponent(m[3]) : null;
        if (!can("read", srcBucket, srcKey) || !can("write", i.Bucket)) throw denied();
        const v = vid ? store.versions(srcBucket, srcKey).find((x) => x.VersionId === vid) : store.latest(srcBucket, srcKey);
        if (!v) throw notFound();
        store.copies.push({ key: i.Key, from: srcKey, versionId: vid, grant: i.GrantFullControl || null });
        store.put(i.Bucket, i.Key, v.body, "2026-09-27T05:00:00Z");
        return { CopyObjectResult: { ETag: v.ETag } };
      }
      throw new Error("unexpected command");
    },
  };
}

// ═════════════════════════════ fixture: backup of D ═══════════════════════════
const B = "radar-immobilier-backup";
const DST = "radar-immobilier-docs-preprod";
const PROD = "radar-immobilier-docs";
const D = "2026-09-26";
const D1 = "2026-09-25";
const NOW_FRESH = Date.parse("2026-09-26T12:00:00Z");
const NOW_STALE = Date.parse("2026-09-27T08:00:00Z"); // dump 02:23 D → 29.6 h

function fixture({ tamperDump = false, rewriteBAfterD = true } = {}) {
  const s = new Store();
  const dump = Buffer.from("PGDMP-fake-custom-archive-bytes-0123456789");
  const dumpV = s.put(B, `pg/${D}/radar.dump`, tamperDump ? Buffer.concat([dump, Buffer.from("x")]) : dump);
  s.put(B, `pg/${D}/radar.dump.sha256`, `${sha(dump)}  radar.dump\n`);
  // docs: a (versionId recorded), b (no versionId; rewritten AFTER D), c (preprod already current)
  const a = s.put(B, "docs/raw/a b.pdf", "AAAA-content", "2026-09-20T01:00:00Z");
  const bD = s.put(B, "docs/raw/b.pdf", "BBBB-at-D", "2026-09-21T01:00:00Z");
  const c = s.put(B, "docs/raw/c.pdf", "CCCC", "2026-09-22T01:00:00Z");
  if (rewriteBAfterD) s.put(B, "docs/raw/b.pdf", "BBBB-rewritten-later!", "2026-09-28T01:00:00Z");
  const inventory = {
    format: "radar-backup-docs-inventory/v1", date: D, createdAt: "2026-09-26T03:40:00.000Z",
    sourceBucket: PROD, backupBucket: B, backupPrefix: "docs/", counts: { objects: 3 },
    objects: [
      { key: "raw/a b.pdf", size: a.Size, etag: a.ETag, state: "backed-up", backupEtag: a.ETag, versionId: a.VersionId },
      { key: "raw/b.pdf", size: bD.Size, etag: bD.ETag, state: "backed-up", backupEtag: bD.ETag, versionId: null },
      { key: "raw/c.pdf", size: c.Size, etag: c.ETag, state: "backed-up", backupEtag: c.ETag, versionId: null },
    ],
  };
  const invBuf = Buffer.from(JSON.stringify(inventory));
  s.put(B, `docs-inventory/${D}.json`, invBuf);
  const manifest = {
    format: "radar-backup-manifest/v1", date: D, status: "complete",
    startedAt: "2026-09-26T02:23:00Z", completedAt: "2026-09-26T03:41:00Z", backupBucket: B,
    pg: { database: "radar", key: `pg/${D}/radar.dump`, sha256: sha(dump), sizeBytes: dump.length, versionId: dumpV.VersionId,
      tocEntries: 189, dumpStartedAt: "2026-09-26T02:23:05Z" },
    schema: { status: "ok", migrationsApplied: 11, lastMigration: { id: 11, tag: "0011_geo" } },
    code: { servedSha: "a4a2c00" },
    docs: { status: "complete", objects: 3, inventoryKey: `docs-inventory/${D}.json`, inventorySha256: sha(invBuf) },
  };
  const manBuf = Buffer.from(JSON.stringify(manifest, null, 2));
  s.put(B, `manifests/${D}.json`, manBuf);
  s.put(B, `manifests/${D1}.json`, JSON.stringify({ ...manifest, date: D1, status: "partial", pg: { ...manifest.pg, key: `pg/${D1}/radar.dump` } }));
  s.put(B, "manifests/latest.json", JSON.stringify({
    format: "radar-backup-latest/v1", date: D, status: "complete", manifestKey: `manifests/${D}.json`, manifestSha256: sha(manBuf),
    latestComplete: { date: D, manifestKey: `manifests/${D}.json` }, firstBackupDate: D1,
  }));
  // preprod: c already current, a absent, b holds the LATER content (must be restored to D)
  s.put(DST, "raw/c.pdf", "CCCC");
  s.put(DST, "raw/b.pdf", "BBBB-rewritten-later!");
  s.put(DST, "runs/extra-newer-than-D.json", "{}");
  return { s, dump, manifest, manSha: sha(manBuf), inventory };
}
// Dedicated preprod identities (k8s, 2026-09-26): the reader sees pg/, manifests/,
// docs-inventory/ only (docs/ → 403); the copy signer reads docs/* and writes preprod.
const readerPolicy = { read: [`${B}/pg/`, `${B}/manifests/`, `${B}/docs-inventory/`], list: [B] };
const copierPolicy = { read: [`${B}/docs/`], listVersions: [B], list: [DST], write: [DST] };
const copierNoVersions = { read: [`${B}/docs/`], list: [DST], write: [DST] };
const baseEnv = (extra = {}) => ({
  S3_ENDPOINT: "s3.bhs.io.cloud.ovh.net", S3_REGION: "bhs", READER_ACCESS_KEY: "r", READER_SECRET_KEY: "r",
  BACKUP_BUCKET: B, EXPECTED_BACKUP_BUCKET: B, ...extra,
});
const tmp = mkdtempSync(join(tmpdir(), "restore-mode-selftest-"));
let tcount = 0;
async function step({ s, env, now = NOW_FRESH, copier = copierPolicy }) {
  const term = join(tmp, `term-${++tcount}.json`);
  const logs = [];
  let r = null; let err = null;
  try {
    r = await br.runStep({ env: { ...env, TERMINATION_LOG: term }, sdk, clients: { reader: client(s, readerPolicy), copier: client(s, copier) }, now: () => now, log: (m) => logs.push(m) });
  } catch (e) { err = e; }
  const t = existsSync(term) ? JSON.parse(readFileSync(term, "utf8")) : null;
  return { r, err, t, logs, code: err ? err.exitCode ?? 1 : r.exitCode };
}

// ═════════════════════════════ pure functions (in-pod) ════════════════════════
eq("parseBackupId — default latest", br.parseBackupId("", D), { kind: "latest", id: "latest" });
eq("parseBackupId — explicit date", br.parseBackupId(D, D).date, D);
throwsCode("parseBackupId — garbage refused", () => br.parseBackupId("2026-13-40", D), 2);
throwsCode("parseBackupId — injection refused", () => br.parseBackupId('x"; rm -rf /', D), 2);
throwsCode("parseBackupId — future refused", () => br.parseBackupId("2026-09-30", D), 2);
throwsCode("chooseDate — no latest.json refused", () => br.chooseDate({ kind: "latest" }, null), 2);
throwsCode("chooseDate — latestComplete empty refused", () => br.chooseDate({ kind: "latest" }, { date: D, latestComplete: null }), 2);
eq("chooseDate — latest → latestComplete (not the newest partial)",
  br.chooseDate({ kind: "latest" }, { date: "2026-09-27", status: "partial", latestComplete: { date: D, manifestKey: `manifests/${D}.json` } }).date, D);
{
  const { manifest } = fixture();
  throwsCode("checkManifest — partial refused", () => br.checkManifest({ ...manifest, status: "partial" }, D), 2);
  throwsCode("checkManifest — incomplete refused", () => br.checkManifest({ ...manifest, status: "incomplete" }, D), 2);
  throwsCode("checkManifest — wrong date refused", () => br.checkManifest(manifest, D1), 2);
  throwsCode("checkManifest — missing refused", () => br.checkManifest(null, D), 2);
  ok("checkManifest — complete accepted", br.checkManifest(manifest, D) === manifest);
  eq("backupReferenceTime — dump start", br.backupReferenceTime(manifest), { source: "pg.dumpStartedAt", at: "2026-09-26T02:23:05.000Z" });
  const g = br.staleGuard({ parsed: { kind: "latest" }, manifest, nowMs: NOW_FRESH, maxAgeHours: 24 });
  eq("staleGuard — fresh latest accepted", [g.stale, g.ageHours], [false, 9.6]);
  throwsCode("staleGuard — latest > 24 h refused", () => br.staleGuard({ parsed: { kind: "latest" }, manifest, nowMs: NOW_STALE, maxAgeHours: 24 }), 2);
  const o = br.staleGuard({ parsed: { kind: "latest" }, manifest, nowMs: NOW_STALE, maxAgeHours: 24, allowStale: true });
  eq("staleGuard — ALLOW_STALE_BACKUP overrides", [o.stale, o.overridden], [true, true]);
  const x = br.staleGuard({ parsed: { kind: "date", date: D }, manifest, nowMs: NOW_STALE + 30 * 86400000, maxAgeHours: 24 });
  eq("staleGuard — explicit date never blocked (logged)", [x.stale, x.blocking], [true, false]);
}
{
  const vs = br.indexVersions([
    { Key: "docs/k", VersionId: "v1", ETag: '"e1"', Size: 5, LastModified: "2026-09-20T00:00:00Z" },
    { Key: "docs/k", VersionId: "v2", ETag: '"e2"', Size: 6, LastModified: "2026-09-28T00:00:00Z" },
    { Key: "other/k", VersionId: "v9", ETag: '"e9"', Size: 1 },
  ]).get("k");
  const created = Date.parse("2026-09-26T03:40:00Z");
  eq("chooseVersion — recorded versionId", br.chooseVersion({ size: 5, backupEtag: '"e1"', versionId: "v1" }, vs, created), { versionId: "v1", how: "version-id" });
  eq("chooseVersion — rewritten since D → ETag of the inventory", br.chooseVersion({ size: 5, backupEtag: '"e1"', versionId: null }, vs, created), { versionId: "v1", how: "etag-before-inventory" });
  eq("chooseVersion — recorded version expired, identical ETag kept", br.chooseVersion({ size: 5, backupEtag: '"e1"', versionId: "gone" }, vs, created).versionId, "v1");
  eq("chooseVersion — size mismatch on recorded version", br.chooseVersion({ size: 9, backupEtag: '"e1"', versionId: "v1" }, vs, created), { error: "size-mismatch" });
  eq("chooseVersion — ETag not found", br.chooseVersion({ size: 5, backupEtag: '"zz"', versionId: null }, vs, created), { error: "etag-not-found" });
  eq("chooseVersion — no version at all", br.chooseVersion({ size: 5, backupEtag: '"e1"' }, undefined, created), { error: "no-version" });
  eq("copySourceFor — encoded key + versionId", br.copySourceFor(B, "raw/a b.pdf", "v 1"), `/${B}/docs/raw/a%20b.pdf?versionId=v%201`);
  const inv = { createdAt: "2026-09-26T03:40:00Z", objects: [{ key: "x", size: 1, state: "pending" }, { key: "y", size: 2, etag: '"e"', state: "backed-up" }] };
  const r = br.reconInventory(inv, new Map([["y", { Size: 2 }], ["z", { Size: 3 }]]));
  eq("reconInventory — not-in-backup fails, extra tolerated", [r.ok, r.notInBackup, r.missing, r.extra], [false, 1, 0, 1]);
  // `excluded` (prefix the backup skips on purpose, backup still complete): not
  // required, counted apart — like the backup; pending/failed still block.
  const invEx = { createdAt: "2026-09-26T03:40:00Z", objects: [{ key: "archive/2019/big.pdf", size: 9, state: "excluded" },
    { key: "y", size: 2, etag: '"e"', backupEtag: '"e"', state: "backed-up" }] };
  const rEx = br.reconInventory(invEx, new Map([["y", { Size: 2, ETag: '"e"' }]]));
  eq("reconInventory — excluded entry not required, counted apart", [rEx.ok, rEx.excluded, rEx.notInBackup, rEx.missing, rEx.extra], [true, 1, 0, 0, 0]);
  const pEx = br.planDocsRestore({ inventory: invEx, versionsIndex: new Map(), destIndex: new Map([["y", { Size: 2, ETag: '"e"' }]]) });
  eq("planDocsRestore — excluded entry skipped (not a refusal), counted apart", [pEx.excluded, pEx.notInBackup, pEx.unresolved, pEx.upToDate, pEx.toCopy.length], [1, 0, 0, 1, 0]);
  const pPend = br.planDocsRestore({ inventory: { ...invEx, objects: [{ key: "p", size: 1, state: "pending" }] }, versionsIndex: new Map(), destIndex: new Map() });
  eq("planDocsRestore — pending entry still blocks (notInBackup)", [pPend.notInBackup, pPend.excluded], [1, 0]);
  const big = br.buildListing({ bucket: B, latest: null, manifests: Array.from({ length: 80 }, (_, k) => ({ date: `2026-0${1 + (k % 9)}-${String(1 + (k % 28)).padStart(2, "0")}`, status: "complete", pg: { sizeBytes: 1, sha256: "a".repeat(64) } })), maxBytes: 1500 });
  ok("buildListing — truncated to fit the termination message", big.truncated && Buffer.byteLength(JSON.stringify(big)) <= 1500);
}
throwsCode("readConfig — docs into the backup bucket refused", () => br.readConfig(baseEnv({ BACKUP_DATE: D, PIN_MANIFEST_SHA256: "a".repeat(64), COPIER_ACCESS_KEY: "c", COPIER_SECRET_KEY: "c", DST_BUCKET: B }), "docs"), 2);
throwsCode("readConfig — docs into a production bucket refused", () => br.readConfig(baseEnv({ BACKUP_DATE: D, PIN_MANIFEST_SHA256: "a".repeat(64), COPIER_ACCESS_KEY: "c", COPIER_SECRET_KEY: "c", DST_BUCKET: PROD, FORBIDDEN_DST_BUCKETS: PROD }), "docs"), 2);
throwsCode("readConfig — empty FORBIDDEN_DST_BUCKETS refused (never 'nothing forbidden')", () => br.readConfig(baseEnv({ BACKUP_DATE: D, PIN_MANIFEST_SHA256: "a".repeat(64), COPIER_ACCESS_KEY: "c", COPIER_SECRET_KEY: "c", DST_BUCKET: DST, FORBIDDEN_DST_BUCKETS: " , " }), "recon"), 2);
eq("forbiddenDstBuckets — frozen prod docs + PROD_DOCS + backup bucket, deduplicated", forbiddenDstBuckets({ prodDocs: PROD, backupBucket: B }), `${PROD},${B}`);
eq("forbiddenDstBuckets — another PROD_DOCS keeps the frozen one", forbiddenDstBuckets({ prodDocs: "other-prod-docs", backupBucket: B, extra: "x-1,  " }), `${FROZEN_PROD_DOCS_BUCKETS[0]},other-prod-docs,${B},x-1`);
throws("forbiddenDstBuckets — PROD_DOCS empty refused (MODE=restore)", () => forbiddenDstBuckets({ prodDocs: "", backupBucket: B }));
throws("forbiddenDstBuckets — malformed name refused", () => forbiddenDstBuckets({ prodDocs: PROD, backupBucket: B, extra: 'a"b' }));
throwsCode("readConfig — reader Secret bucket ≠ expected refused", () => br.readConfig(baseEnv({ BACKUP_BUCKET: "other-bucket" }), "resolve"), 2);
throwsCode("readConfig — invalid PIN refused", () => br.readConfig(baseEnv({ BACKUP_DATE: D, PIN_MANIFEST_SHA256: "nope", PIN_PG_SHA256: "a".repeat(64) }), "fetch-dump"), 2);

// ═════════════════════════════ steps against the fake ═════════════════════════
async function suite() {
  // resolve
  {
    const { s, manSha, dump } = fixture();
    const r = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: "latest" }) });
    eq("resolve latest — exit 0", r.code, 0);
    eq("resolve latest — PIN date/sha", [r.t.date, r.t.manifestSha256 === manSha, r.t.pgSha256 === sha(dump), r.t.source], [D, true, true, "latestComplete"]);
    ok("resolve — termination message fits 4 KiB", Buffer.byteLength(JSON.stringify(r.t)) < 4096);
    ok("resolve — logs carry no doc key", !r.logs.join("\n").includes("raw/"));
    const pin = validatePin(r.t);
    eq("validatePin — accepts the resolve verdict", pin.date, D);
    const st = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: "latest" }), now: NOW_STALE });
    eq("resolve latest > 24 h — refused (exit 2)", st.code, 2);
    ok("resolve stale — reason in the termination message", /ALLOW_STALE_BACKUP/.test(st.t.reason) && st.t.ok === false);
    const ov = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: "latest", ALLOW_STALE_BACKUP: "true" }), now: NOW_STALE });
    eq("resolve latest > 24 h + ALLOW_STALE_BACKUP — accepted", [ov.code, ov.t.staleOverridden], [0, true]);
    const ex = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: D }), now: NOW_STALE });
    eq("resolve explicit date > 24 h — accepted, age logged", [ex.code, ex.t.stale, ex.t.ageBlocking], [0, true, false]);
    const pa = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: D1 }) });
    eq("resolve partial backup — refused (complete required)", pa.code, 2);
    const gone = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: "2026-09-01" }) });
    eq("resolve purged/absent date — refused", gone.code, 2);
  }
  {
    const { s } = fixture();
    s.put(B, `pg/${D}/radar.dump.sha256`, `${"b".repeat(64)}  radar.dump\n`);
    const r = await step({ s, env: baseEnv({ BR_STEP: "resolve" }) });
    eq("resolve — sidecar sha256 ≠ manifest ⇒ fail", r.code, 1);
  }
  // list
  {
    const { s } = fixture();
    const r = await step({ s, env: baseEnv({ BR_STEP: "list" }) });
    eq("list — exit 0, 2 backups, newest first", [r.code, r.t.count, r.t.backups.map((b) => b.date)], [0, 2, [D, D1]]);
    const l = validateListing(r.t);
    eq("validateListing — statuses", l.backups.map((b) => b.status), ["complete", "partial"]);
    ok("formatBackupTable — marks latest complete", formatBackupTable(l).text.includes(`${D} *`));
  }
  // fetch-dump
  {
    const { s, manSha, dump } = fixture();
    const work = join(tmp, "work-ok");
    const r = await step({ s, env: baseEnv({ BR_STEP: "fetch-dump", BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, PIN_PG_SHA256: sha(dump), WORK_DIR: work }) });
    eq("fetch-dump — exit 0", r.code, 0);
    ok("fetch-dump — dump bytes identical", readFileSync(join(work, "radar.dump")).equals(dump));
    ok("fetch-dump — backup.env facts", /EXPECTED_TOC_ENTRIES=189/.test(readFileSync(join(work, "backup.env"), "utf8")));
    const pinBad = await step({ s, env: baseEnv({ BR_STEP: "fetch-dump", BACKUP_DATE: D, PIN_MANIFEST_SHA256: "c".repeat(64), PIN_PG_SHA256: sha(dump), WORK_DIR: join(tmp, "w2") }) });
    eq("fetch-dump — manifest changed since resolve ⇒ refused", pinBad.code, 2);
  }
  {
    const { s, manSha, dump } = fixture({ tamperDump: true });
    const r = await step({ s, env: baseEnv({ BR_STEP: "fetch-dump", BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, PIN_PG_SHA256: sha(dump), WORK_DIR: join(tmp, "w3") }) });
    eq("fetch-dump — tampered dump (size/sha) ⇒ restore refused", r.code, 1);
  }
  // docs
  const docsEnv = (manSha, extra = {}) => baseEnv({ BR_STEP: "docs", BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, COPIER_ACCESS_KEY: "c", COPIER_SECRET_KEY: "c",
    DST_BUCKET: DST, FORBIDDEN_DST_BUCKETS: PROD, COPY_GRANTEE: "1901410700457444:user-x", COPY_CONCURRENCY: "2", ...extra });
  {
    const { s, manSha } = fixture();
    const dry = await step({ s, env: docsEnv(manSha, { DOCS_DRY: "1" }) });
    eq("docs DRY — plan: 1 up to date, 2 to copy, 0 copy done", [dry.code, dry.t.upToDate, dry.t.toCopy, s.copies.length], [0, 1, 2, 0]);
    const r = await step({ s, env: docsEnv(manSha) });
    eq("docs — exit 0, 2 copies, recon ok", [r.code, r.t.copied, r.t.recon.ok], [0, 2, true]);
    ok("docs — b.pdf restored to its content AT D (not the later rewrite)", s.latest(DST, "raw/b.pdf").body.toString() === "BBBB-at-D");
    ok("docs — a b.pdf copied by recorded versionId + grant", s.copies.some((c) => c.key === "raw/a b.pdf" && c.versionId && c.grant === "id=1901410700457444:user-x"));
    ok("docs — additive: preprod object newer than D kept", !!s.latest(DST, "runs/extra-newer-than-D.json"));
    eq("docs — extra counted in recon", r.t.recon.extra, 1);
    ok("docs — logs carry no doc key", !r.logs.join("\n").includes("raw/"));
    const again = await step({ s, env: docsEnv(manSha) });
    eq("docs — idempotent re-run: 0 copy", [again.code, again.t.copied], [0, 0]);
    const rec = await step({ s, env: { ...docsEnv(manSha), BR_STEP: "recon" } });
    eq("recon — preprod ⊇ inventory(D)", [rec.code, rec.t.ok], [0, true]);
  }
  {
    const { s, manSha } = fixture();
    // make b unresolvable: drop every backup version of b.pdf
    s.b.get(B).delete("docs/raw/b.pdf");
    const r = await step({ s, env: docsEnv(manSha) });
    eq("docs — an unrestorable object ⇒ refused before any copy", [r.code, s.copies.length, r.t.unresolved], [2, 0, 1]);
  }
  {
    const { s, manSha } = fixture();
    const wrong = await br.runStep({
      env: { ...docsEnv(manSha), TERMINATION_LOG: join(tmp, "t-wrong.json") }, sdk,
      clients: { reader: client(s, readerPolicy), copier: client(s, readerPolicy) }, now: () => NOW_FRESH, log: () => {},
    }).then((x) => x.exitCode, (e) => e.exitCode ?? 1);
    eq("docs — the reader (no docs/*, no preprod) as copy identity ⇒ fails (identity split enforced)", wrong, 1);
  }
  {
    // copy signer without ListBucketVersions: recorded versionIds used as is, the
    // others checked by HEAD — b rewritten after D ⇒ current differs ⇒ refusal.
    const { s, manSha } = fixture();
    const r = await step({ s, env: docsEnv(manSha), copier: copierNoVersions });
    eq("docs — no version listing + object rewritten since D ⇒ refused before any copy", [r.code, s.copies.length, r.t.unresolvedReasons], [2, 0, { "current-differs": 1 }]);
    ok("docs — fallback announced in the log", r.logs.some((l) => /version listing .* not permitted/.test(l)));
  }
  {
    const { s, manSha } = fixture({ rewriteBAfterD: false });
    s.b.get(DST).delete("raw/b.pdf");
    const r = await step({ s, env: docsEnv(manSha), copier: copierNoVersions });
    eq("docs — no version listing, current = D content ⇒ recorded versionId + HEAD-checked current copied, recon ok",
      [r.code, r.t.copied, r.t.recon.ok, s.copies.map((c) => [c.key, !!c.versionId]).sort()], [0, 2, true, [["raw/a b.pdf", true], ["raw/b.pdf", false]]]);
  }
  {
    const { s, manSha } = fixture();
    const before = await step({ s, env: { ...docsEnv(manSha), BR_STEP: "recon" } });
    eq("recon — before the restore: a missing, b size differs ⇒ fail", [before.code, before.t.missing, before.t.sizeMismatch], [1, 1, 1]);
    await step({ s, env: docsEnv(manSha) });
    s.b.get(DST).delete("raw/c.pdf");
    const rec = await step({ s, env: { ...docsEnv(manSha), BR_STEP: "recon" } });
    eq("recon — object deleted after the restore ⇒ fail", [rec.code, rec.t.missing], [1, 1]);
  }
}

// ═════════════════════════════ runner pure functions ══════════════════════════
eq("basculeMode — default chain", basculeMode({}), "chain");
throws("basculeMode — unknown refused", () => basculeMode({ MODE: "wipe" }));
eq("validateBackupIdInput — latest", validateBackupIdInput("", D), "latest");
throws("validateBackupIdInput — quote refused", () => validateBackupIdInput('2026-09-26"', D));
eq("validateCycleId — orchestrator id", validateCycleId("iso-prod-2026-09-26-t0abc"), "iso-prod-2026-09-26-t0abc");
throws("validateCycleId — space refused", () => validateCycleId("a b"));
eq("indentBlock — empty lines kept empty", indentBlock("a\n\nb", 2), "  a\n\n  b");
throws("assertYamlSafeVars — quote refused", () => assertYamlSafeVars({ X: 'a"b' }));
ok("assertYamlSafeVars — BR_SCRIPT skipped", assertYamlSafeVars({ BR_SCRIPT: 'a"b', Y: "ok" }));
throws("assertScriptEmbeddable — placeholder pattern refused", () => assertScriptEmbeddable("x ${NAMESPACE} y"));
ok("safeReason — no workflow command, one line", !/::|\n/.test(safeReason("a\n::error::x")));
{
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U0 = "00000000-0000-4000-8000-000000000000";
  const own = (uid) => [{ kind: "Job", name: "radar-db-restore-backup", uid, controller: true }];
  const pods = { items: [
    { metadata: { creationTimestamp: "2026-09-26T10:00:00Z", ownerReferences: own(U1) }, status: { initContainerStatuses: [{ name: "fetch", state: { terminated: { message: '{"ok":false,"reason":"old"}' } } }] } },
    { metadata: { creationTimestamp: "2026-09-26T11:00:00Z", ownerReferences: own(U1) }, status: { initContainerStatuses: [{ name: "fetch", state: { terminated: { message: '{"ok":true,"step":"fetch-dump"}' } } }], containerStatuses: [{ name: "restore", state: { running: {} } }] } },
    // pod of a PREVIOUS instance of the same Job name (deleted, still listed), newest of all
    { metadata: { creationTimestamp: "2026-09-26T12:00:00Z", ownerReferences: own(U0), labels: { "batch.kubernetes.io/controller-uid": U0 } }, status: { initContainerStatuses: [{ name: "fetch", state: { terminated: { message: '{"ok":true,"step":"stale"}' } } }] } },
  ] };
  eq("pickTerminationMessage — newest pod OF THIS Job instance, init container", parseTermination(pickTerminationMessage(pods, "fetch", U1)), { ok: true, step: "fetch-dump" });
  eq("pickTerminationMessage — a pod of an older instance is never read", parseTermination(pickTerminationMessage({ items: [pods.items[2]] }, "fetch", U1)), null);
  eq("pickTerminationMessage — no Job uid ⇒ nothing read (no guess)", pickTerminationMessage(pods, "fetch", null), null);
  eq("pickTerminationMessage — none", pickTerminationMessage(pods, "restore", U1), null);
  ok("podOfJob — controller-uid label accepted (legacy or batch.kubernetes.io)", podOfJob({ metadata: { labels: { "controller-uid": U1 } } }, U1) &&
    podOfJob({ metadata: { labels: { "batch.kubernetes.io/controller-uid": U1 } } }, U1) && !podOfJob({ metadata: { labels: { "controller-uid": U0 } } }, U1));
}
{
  const common0 = { mode: "restore", backupDate: D, rollbackKey: "rollback/preprod-rollback-2026-09-26T12-00-00-000Z.dump", dumpBucket: "radar-immobilier-backups-preprod",
    expectedDatabase: "radar", bhs: "s3.bhs.io.cloud.ovh.net", namespace: "radar-immobilier-preprod" };
  const s1 = buildFailureSummary({ ...common0, outcomes: { migrate: "success", docs: "failure", recon: "skipped", flip: "skipped", unquiesce: "success", smoke: "success" } });
  ok("failure-summary — restore, docs failed: 'back in service on a database at day D, docs/flip INCOMPLETE'",
    s1.head === `Preprod back in service on a database at day D = ${D} (backup) — docs/flip INCOMPLETE`);
  ok("failure-summary — G1 rollback procedure with the exact key (quiesce → restore DUMP_PREFIX=<key> → unquiesce)",
    s1.markdown.includes(`DUMP_PREFIX=${common0.rollbackKey} T1_EPOCH=0 DUMP_KEY_ASSERT_DB=0 node deploy/ci/bascule-preprod/bascule.mjs restore`) &&
    s1.markdown.indexOf("bascule.mjs quiesce") < s1.markdown.indexOf("bascule.mjs restore") && s1.markdown.includes(`s3://radar-immobilier-backups-preprod/${common0.rollbackKey}`));
  const s2 = buildFailureSummary({ ...common0, mode: "chain", backupDate: null, t1: "2026-09-26T03:17:00.000Z", outcomes: { unquiesce: "failure" } });
  ok("failure-summary — un-quiesce failed ⇒ 'NOT back in service'", /NOT back in service \(un-quiesce: failure\)/.test(s2.head) && /T1 2026-09-26T03:17:00.000Z/.test(s2.head));
  const s3 = buildFailureSummary({ ...common0, rollbackKey: null, outcomes: { docs: "success", recon: "success", flip: "success", unquiesce: "success", smoke: "failure" } });
  ok("failure-summary — after the flip / no rollback key recorded", /failed after the flip/.test(s3.head) && /No G1 rollback key recorded/.test(s3.markdown));
}
throws("validatePin — bad sha refused", () => validatePin({ ok: true, date: D, manifestSha256: "x", pgSha256: "a".repeat(64), pgSizeBytes: 1, backupId: "latest" }));
throws("validatePin — not ok refused", () => validatePin({ ok: false }));
eq("JOBS — stable Job names", JOBS.db, "radar-db-restore-backup");

// ═════════════════════════════ script under `node -e` ═════════════════════════
const SCRIPT = readFileSync(join(DIR, "backup-restore.cjs"), "utf8");
ok("backup-restore.cjs — embeddable (no ${UPPER} sequence)", assertScriptEmbeddable(SCRIPT));
{
  const term = join(tmp, "node-e.json");
  const r = spawnSync(process.execPath, ["-e", SCRIPT], { cwd: tmp, env: { PATH: process.env.PATH, BR_STEP: "resolve", TERMINATION_LOG: term }, encoding: "utf8" });
  const t = existsSync(term) ? JSON.parse(readFileSync(term, "utf8")) : null;
  eq("node -e — main triggered, exit 1 without the SDK, verdict written", [r.status, t && t.ok, /client-s3/.test(t && t.reason)], [1, false, true]);
  const r2 = spawnSync(process.execPath, ["-e", SCRIPT], { cwd: tmp, env: { PATH: process.env.PATH, BR_STEP: "bogus", TERMINATION_LOG: term }, encoding: "utf8" });
  eq("node -e — unknown step refused (exit 2)", r2.status, 2);
}

// ═════════════════════════════ templates render ═══════════════════════════════
function render(tmpl, vars) {
  let text = readFileSync(join(DIR, tmpl), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.split(`\${${k}}`).join(v);
  return { text, leftover: text.match(/\$\{[A-Z0-9_]+\}/g) };
}
let YAML = null;
try { YAML = (await import("yaml")).default; } catch { YAML = null; }
const common = { NAMESPACE: "radar-immobilier-preprod", IMAGE: "ghcr.io/rhanka/radar-api@sha256:" + "a".repeat(64), READER_SECRET: "radar-backup-reader-preprod",
  S3_ENDPOINT: "https://s3.bhs.io.cloud.ovh.net", S3_REGION: "bhs", S3_FORCE_PATH_STYLE: "true", EXPECTED_BACKUP_BUCKET: B, TTL_SECONDS: "3600",
  BR_SCRIPT: indentBlock(SCRIPT, 14) };
const renders = {
  "backup-read-job.tmpl.yaml": { ...common, JOB_NAME: JOBS.resolve, BR_STEP: "resolve", BACKUP_ID: "latest", ALLOW_STALE_BACKUP: "false", MAX_AGE_HOURS: "24" },
  "db-restore-backup-job.tmpl.yaml": { ...common, DUMP_IMAGE: "postgis/postgis:16-3.4", BACKUP_DATE: D, PIN_MANIFEST_SHA256: "a".repeat(64), PIN_PG_SHA256: "b".repeat(64),
    DB_SECRET: "radar-db-credentials", PGHOST: "radar-postgres", EXPECTED_DATABASE: "radar", RESTORE_ASSERT_DB: "1" },
  "docs-restore-backup-job.tmpl.yaml": { ...common, JOB_NAME: JOBS.docs, BR_STEP: "docs", COPY_SECRET: "radar-backup-restore-docs", BACKUP_DATE: D, PIN_MANIFEST_SHA256: "a".repeat(64),
    DST_BUCKET: DST, FORBIDDEN_DST_BUCKETS: PROD, COPY_GRANTEE: "g", COPY_CONCURRENCY: "8", DOCS_DRY: "0" },
};
for (const [tmpl, vars] of Object.entries(renders)) {
  const { text, leftover } = render(tmpl, vars);
  ok(`${tmpl} — no leftover placeholder`, !leftover);
  const m = text.match(/command: \["node", "-e"\]\n {10}args:\n {12}- \|\n([\s\S]*?)\n {10}env:/);
  const back = m ? m[1].split("\n").map((l) => l.replace(/^ {14}/, "")).join("\n") : "";
  ok(`${tmpl} — embedded script recovered byte-identical`, back.trimEnd() === SCRIPT.trimEnd());
  ok(`${tmpl} — carries the bascule label (G2 exclusion + netpol)`, /sentropic\.io\/bascule:/.test(text));
  if (YAML) {
    const doc = YAML.parse(text);
    const pod = doc.spec.template.spec;
    const node = [...(pod.initContainers || []), ...pod.containers].find((c) => c.command && c.command[0] === "node");
    ok(`${tmpl} — YAML parses, node -e arg == script`, node && node.args[0].trimEnd() === SCRIPT.trimEnd());
    ok(`${tmpl} — automountServiceAccountToken false`, pod.automountServiceAccountToken === false);
  }
}
if (!YAML) console.log("  info yaml package not resolvable — YAML parse checks skipped (structure checks done)");

// ═════════════════════════════ workflow wiring ════════════════════════════════
{
  const wf = readFileSync(join(DIR, "..", "..", "..", ".github", "workflows", "bascule-preprod.yml"), "utf8");
  for (const c of ["preflight-backup", "backup-resolve", "backup-list", "restore-backup", "docs-restore", "recon-backup"]) {
    ok(`workflow — step runs '${c}'`, wf.includes(`node "$CLI" ${c}`));
  }
  ok("workflow — MODE choice chain|restore|list", /MODE:\n\s+description:[^\n]*\n\s+required: false\n\s+type: choice\n\s+options: \[chain, restore, list\]\n\s+default: chain/.test(wf));
  ok("workflow — S1 dump chain only", /id: dump\n\s+if: \$\{\{ !inputs\.DRY_RUN && env\.MODE == 'chain' \}\}/.test(wf));
  ok("workflow — PROD kubeconfig chain only", /Configure kubeconfig PROD[^\n]*\n\s+if: \$\{\{ !inputs\.DRY_RUN && env\.MODE == 'chain' \}\}/.test(wf));
  ok("workflow — resolve before quiesce", wf.indexOf('node "$CLI" backup-resolve') < wf.indexOf('node "$CLI" quiesce'));
  ok("workflow — refresh never in restore mode", /S6 refresh[^\n]*\n\s+if: \$\{\{[^}]*env\.MODE == 'chain' \}\}/.test(wf));
  ok("workflow — scheduled gate unchanged", wf.includes("if: ${{ github.event_name != 'schedule' || vars.BASCULE_SCHEDULE_ENABLED == 'true' }}"));
  const runs = [...wf.matchAll(/run: (?:\|\n((?: {10,}.*\n?)+)|(.*))/g)].map((m) => m[1] || m[2]);
  const newRuns = runs.filter((r) => /served-ids\.mjs|preflight-backup|backup-|restore-backup|docs-restore|recon-backup/.test(r));
  ok(`workflow — no \${{ }} interpolation in the ${newRuns.length} new run blocks`, newRuns.length >= 9 && newRuns.every((r) => !r.includes("${{")));
  ok("workflow — no input interpolated in any run block", runs.every((r) => !/\$\{\{\s*inputs\./.test(r)));
  if (YAML) {
    const doc = YAML.parse(wf);
    const n = Object.keys(doc.on.workflow_dispatch.inputs).length;
    ok(`workflow — ${n} dispatch inputs (<= 25)`, n <= 25);
    ok("workflow — served-ids + cycle-leg jobs hold no secret", !JSON.stringify(doc.jobs["served-ids"]).includes("secrets.") && !JSON.stringify(doc.jobs["cycle-leg"]).includes("secrets."));
  }
}

// ═════════════════════════════ docs-sync Secret (rewritten every run) ═════════
{
  const AK = "0123456789abcdef0123456789abcdef";
  const SK = "fedcba9876543210fedcba9876543210";
  const v = secretValuesFromEnv({ RADAR_DOCS_SYNC_ACCESS_KEY: `${AK}\n`, RADAR_DOCS_SYNC_SECRET_KEY: SK });
  eq("secretValuesFromEnv — keys of docs-sync-job, trailing newline stripped", v, { S3_ACCESS_KEY: AK, S3_SECRET_KEY: SK });
  throws("secretValuesFromEnv — missing GitHub secret ⇒ fail-closed", () => secretValuesFromEnv({ RADAR_DOCS_SYNC_ACCESS_KEY: AK }));
  throws("secretValuesFromEnv — not ^[0-9a-f]{32,64}$ ⇒ fail-closed", () => secretValuesFromEnv({ RADAR_DOCS_SYNC_ACCESS_KEY: AK, RADAR_DOCS_SYNC_SECRET_KEY: "AKIA-UPPER-not-hex" }));
  throws("secretValuesFromEnv — too short ⇒ fail-closed", () => secretValuesFromEnv({ RADAR_DOCS_SYNC_ACCESS_KEY: "abc123", RADAR_DOCS_SYNC_SECRET_KEY: SK }));
  try { secretValuesFromEnv({ RADAR_DOCS_SYNC_ACCESS_KEY: AK, RADAR_DOCS_SYNC_SECRET_KEY: "zz" + SK }); } catch (e) {
    ok("secretValuesFromEnv — error names the secret, never the value", /RADAR_DOCS_SYNC_SECRET_KEY/.test(e.message) && !e.message.includes(SK));
  }
  const tmplKeys = [...readFileSync(join(DIR, "docs-sync-job.tmpl.yaml"), "utf8").matchAll(/name: \$\{DOCS_SYNC_READ_SECRET\}, key: ([A-Z0-9_]+)/g)].map((m) => m[1]).sort();
  eq("DOCS_SYNC_SECRET_KEYS — exactly the keys docs-sync-job.tmpl.yaml reads", Object.keys(DOCS_SYNC_SECRET_KEYS).sort(), tmplKeys);
  const man = buildSecretManifest({ name: "radar-docs-src-preprod", namespace: "radar-immobilier-preprod", values: v,
    labels: { "app.kubernetes.io/name": "radar-immobilier" }, annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{}", keep: "1" } });
  eq("buildSecretManifest — base64 data, Opaque, no ownerReferences", [man.type, man.data.S3_ACCESS_KEY, !!man.metadata.ownerReferences], ["Opaque", Buffer.from(AK).toString("base64"), false]);
  eq("buildSecretManifest — only the 2 keys", Object.keys(man.data).sort(), ["S3_ACCESS_KEY", "S3_SECRET_KEY"]);
  eq("buildSecretManifest — labels kept, last-applied dropped", [man.metadata.labels["app.kubernetes.io/name"], Object.keys(man.metadata.annotations)], ["radar-immobilier", ["keep"]]);
  throws("buildSecretManifest — invalid name refused", () => buildSecretManifest({ name: "Bad_Name", namespace: "b", values: {} }));
  const wf = readFileSync(join(DIR, "..", "..", "..", ".github", "workflows", "bascule-preprod.yml"), "utf8");
  const rbac = readFileSync(join(DIR, "rbac-ci-bascule-preprod-docs-secret.yaml"), "utf8");
  if (YAML) {
    const [role] = YAML.parseAllDocuments(rbac).map((d) => d.toJSON());
    const docs = YAML.parseAllDocuments(rbac).map((d) => d.toJSON());
    const cms = ["immo-served-refs-0", "immo-served-refs-1", "immo-served-refs-2", "immo-served-refs-3"];
    eq("RBAC — runner: secrets get/update on the 3 Secrets only + configmaps get on the refs", role.rules, [
      { apiGroups: [""], resources: ["secrets"], verbs: ["get", "update"], resourceNames: ["radar-docs-src-preprod", "radar-backup-reader-preprod", "radar-backup-restore-docs"] },
      { apiGroups: [""], resources: ["configmaps"], verbs: ["get"], resourceNames: cms }]);
    const writer = docs.find((d) => d.kind === "Role" && d.metadata.name === "radar-bascule-refs-writer");
    eq("RBAC — refs writer: configmaps get/update on the 4 names only", writer.rules, [{ apiGroups: [""], resources: ["configmaps"], verbs: ["get", "update"], resourceNames: cms }]);
    ok("RBAC — no create/patch/delete/list anywhere", !/"(create|patch|delete|list|watch)"/.test(JSON.stringify(docs.filter((d) => d.kind === "Role"))));
  } else ok("RBAC — name-scoped get/update", /verbs: \["get", "update"\]\n\s+resourceNames: \["radar-docs-src-preprod", "radar-backup-reader-preprod", "radar-backup-restore-docs"\]/.test(rbac));
  // every backup Secret spec keeps the key set of the pre-created Secrets (k8s)
  const h32 = "0123456789abcdef0123456789abcdef";
  const benv = { RADAR_BACKUP_READER_PREPROD_ACCESS_KEY: h32, RADAR_BACKUP_READER_PREPROD_SECRET_KEY: h32, RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY: h32, RADAR_BACKUP_RESTORE_DOCS_SECRET_KEY: h32 };
  for (const spec of ["backup-reader", "backup-restore-docs"]) {
    const sp = SECRET_SPECS[spec];
    eq(`ci-secrets — ${spec}: keys S3_ACCESS_KEY, S3_SECRET_KEY, BACKUP_BUCKET`, Object.keys(secretValuesFromEnv(benv, sp.keys, sp.fixed)).sort(), ["BACKUP_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]);
  }
  eq("ci-secrets — default names", ["docs-sync", "backup-reader", "backup-restore-docs"].map((s) => secretNameFor(s, {})), ["radar-docs-src-preprod", "radar-backup-reader-preprod", "radar-backup-restore-docs"]);
  eq("ci-secrets — BACKUP_BUCKET fixed value from the var", secretValuesFromEnv({ ...benv, BACKUP_BUCKET: "radar-immobilier-backup" }, SECRET_SPECS["backup-reader"].keys, SECRET_SPECS["backup-reader"].fixed).BACKUP_BUCKET, "radar-immobilier-backup");
  throws("ci-secrets — malformed BACKUP_BUCKET ⇒ fail-closed", () => secretValuesFromEnv({ ...benv, BACKUP_BUCKET: 'x"; drop' }, SECRET_SPECS["backup-reader"].keys, SECRET_SPECS["backup-reader"].fixed));
  eq("ci-secrets — specs per MODE", ["chain", "list", "restore"].map(specsForMode), [["docs-sync"], ["backup-reader"], ["backup-reader", "backup-restore-docs"]]);
  const bfill = wf.match(/- name: Write backup Secrets from GitHub[^\n]*\n((?: {8}.*\n)+)/);
  ok("workflow — backup Secrets step: 4 secrets via env:, run without interpolation, not in MODE=chain",
    !!bfill && /if: \$\{\{ env\.MODE != 'chain' \}\}/.test(bfill[1]) && (bfill[1].match(/\$\{\{ secrets\.RADAR_BACKUP_(READER_PREPROD|RESTORE_DOCS)_(ACCESS|SECRET)_KEY \}\}/g) || []).length === 4 &&
    /run: node "\$CLI" backup-secrets-fill\n/.test(bfill[1]));
  ok("workflow — backup Secrets written before R0 / list", wf.indexOf('node "$CLI" backup-secrets-fill') < wf.indexOf('node "$CLI" backup-resolve') && wf.indexOf('node "$CLI" backup-secrets-fill') < wf.indexOf('node "$CLI" backup-list'));
  const preprodFiles = ["restore-mode.mjs", "backup-restore.cjs", "ci-secrets.mjs", "backup-read-job.tmpl.yaml", "db-restore-backup-job.tmpl.yaml", "docs-restore-backup-job.tmpl.yaml", "README.md"]
    .map((f) => readFileSync(join(DIR, f), "utf8")).join("\n") + wf;
  ok("no reference to an unsuffixed preprod Secret radar-backup-reader", !/radar-backup-reader(?![-\w])/.test(preprodFiles.replace(/ns `radar-immobilier`[^\n]*radar-backup-reader[^\n]*/g, "")));
  ok("no GetObjectVersion permission required (OVH refuses it in policies)", !/GetObject \+ GetObjectVersion|GetObjectVersion on|`GetObjectVersion`/.test(preprodFiles));
  const red = redact(`error: ${v.S3_SECRET_KEY} / ${Buffer.from(v.S3_SECRET_KEY).toString("base64")}`, v);
  ok("redact — raw and base64 values removed", !red.includes(v.S3_SECRET_KEY) && !red.includes(Buffer.from(v.S3_SECRET_KEY).toString("base64")));
  const f = writePrivateManifest(man);
  const modeOf = (p) => statSync(p).mode & 0o777;
  eq("writePrivateManifest — dir 0700, file 0600", [modeOf(f.dir), modeOf(f.file)], [0o700, 0o600]);
  f.cleanup();
  ok("writePrivateManifest — cleanup removes the file", !existsSync(f.file));
  ok("workflow — bascule job in environment radar-bascule", /\n {4}environment: radar-bascule\n/.test(wf));
  const fill = wf.match(/- name: docs-sync Secret — rewrite from GitHub[^\n]*\n((?: {8}.*\n)+)/);
  ok("workflow — fill step (chain, not DRY): secrets via env:, run without interpolation", !!fill &&
    /if: \$\{\{ env\.MODE == 'chain' && !inputs\.DRY_RUN \}\}/.test(fill[1]) &&
    /RADAR_DOCS_SYNC_ACCESS_KEY: \$\{\{ secrets\.RADAR_DOCS_SYNC_ACCESS_KEY \}\}/.test(fill[1]) && /run: node "\$CLI" docs-secret-fill\n/.test(fill[1]));
  const check = wf.match(/- name: docs-sync Secret — check only[^\n]*\n((?: {8}.*\n)+)/);
  ok("workflow — DRY chain: server dry-run check only (nothing written)", !!check && /if: \$\{\{ env\.MODE == 'chain' && inputs\.DRY_RUN \}\}/.test(check[1]) &&
    /run: node "\$CLI" docs-secret-fill --check\n/.test(check[1]));
  const fillAt = wf.indexOf('node "$CLI" docs-secret-fill');
  ok("workflow — docs-sync Secret written BEFORE the quiesce and any destructive step (like the backup Secrets)",
    fillAt > 0 && fillAt < wf.indexOf('node "$CLI" quiesce') && fillAt < wf.indexOf('node "$CLI" dump') && fillAt < wf.indexOf('node "$CLI" restore\n') &&
    fillAt < wf.indexOf('node "$CLI" precheck-runs --prod'));
  ok("workflow — the Secret is NOT blanked at the end (durable credential)", !wf.includes("docs-secret-blank"));
  ok("workflow — no secrets.* in any run block", ![...wf.matchAll(/run: (?:\|\n((?: {10,}.*\n?)+)|(.*))/g)].some((m) => /secrets\./.test(m[1] || m[2])));
  ok("workflow — no ${{ github.* }} in any run block", ![...wf.matchAll(/run: (?:\|\n((?: {10,}.*\n?)+)|(.*))/g)].some((m) => /\$\{\{\s*github\./.test(m[1] || m[2])));
  // G3 in every MODE, before any kubectl write / Secret write / Job
  const g3At = wf.indexOf('node "$CLI" confirm');
  ok("workflow — G3 step unconditional (every MODE), before kubectl setup, Secrets and Jobs",
    /- name: G3 CONFIRM[^\n]*\n\s+run: node "\$CLI" confirm\n/.test(wf) && g3At > 0 && g3At < wf.indexOf("Install kubectl") &&
    g3At < wf.indexOf('node "$CLI" backup-secrets-fill') && g3At < fillAt && g3At < wf.indexOf('node "$CLI" backup-list'));
  ok("workflow — job budget per MODE: restore 330, else 180 (cap 360)", wf.includes("timeout-minutes: ${{ (inputs.MODE || 'chain') == 'restore' && 330 || 180 }}"));
  ok("workflow — un-quiesce: always(), own step budget, SKIP_QUIESCE passed to the CLI", /id: unquiesce\n\s+if: \$\{\{ always\(\)[^\n]*\n\s+timeout-minutes: 15\n\s+run: node "\$CLI" unquiesce/.test(wf) &&
    wf.includes("SKIP_QUIESCE: ${{ inputs.SKIP_QUIESCE && 'true' || 'false' }}"));
  const qsAt = wf.indexOf("name: bascule-quiesce-state-");
  ok("workflow — quiesce-state uploaded right after the quiesce (recovery after a job timeout)", qsAt > wf.indexOf('node "$CLI" quiesce') &&
    qsAt < wf.indexOf('node "$CLI" dump'));
  const fsum = wf.match(/- name: Failure after S2[^\n]*\n((?: {8}.*\n)+)/);
  ok("workflow — failure after a successful S2 ⇒ summary step (failure(), S2 success, outcomes via env:)", !!fsum &&
    /if: \$\{\{ failure\(\) && !inputs\.DRY_RUN && env\.MODE != 'list' && \(steps\.restore_chain\.outcome == 'success' \|\| steps\.restore_backup\.outcome == 'success'\) \}\}/.test(fsum[1]) &&
    /run: node "\$CLI" failure-summary\n/.test(fsum[1]));
}

// ═════════════════════════════ served-ids.mjs ═════════════════════════════════
eq("mapOutcome — skipped ⇒ failure", mapOutcome("skipped"), "failure");
eq("combine — all success", combine(["success", "success"]), "success");
eq("combine — one pending", combine(["success", ""]), "pending");
eq("immoVerdict — restore", immoVerdict("restore", { restoreBackup: "success", migrate: "success", docsBackup: "success", reconBackup: "success", smoke: "failure" }), { pg: "success", s3: "failure" });
{
  const leg = buildImmoLeg({ cycleId: "c1", runId: "42", gitSha: "abcdef1234", mode: "restore",
    backup: { id: "latest", date: D, manifestSha256: "a".repeat(64), pgSha256: "b".repeat(64), dumpStartedAt: "2026-09-26T02:23:05Z" },
    outcomes: { restoreBackup: "success", migrate: "success", docsBackup: "success", reconBackup: "success", smoke: "success" }, servedIdsSha256: null });
  eq("buildImmoLeg — legs.immo shape", [leg.run_id, leg.sha_main, leg.backup.date, leg.t1, leg.verdict, leg.served_ids_artifact],
    ["42", "abcdef1", D, "2026-09-26T02:23:05.000Z", { pg: "success", s3: "success" }, "immo-served-canonical-ids-c1"]);
  throws("buildImmoLeg — list mode refused", () => buildImmoLeg({ cycleId: "c1", runId: "1", gitSha: "abcdef1", mode: "list" }));
}
eq("artefact names", [servedIdsArtifactName("c1"), cycleLegArtifactName("c1")], ["immo-served-canonical-ids-c1", "cycle-leg-immo-c1"]);
throws("normalizeRawRefs — bad slug refused", () => normalizeRawRefs({ zones: [{ citySlug: "Bad Slug", zoneCode: "A1" }] }));
eq("normalizeRawRefs — empty code dropped, lots ignored", (({ zones, dropped, lotsIgnored }) => [zones.length, dropped, lotsIgnored])(normalizeRawRefs({ zones: [{ citySlug: "laval", zoneCode: "A1" }, { citySlug: "laval", zoneCode: " " }], lots: [{}] })), [1, 1, 1]);
throws("assertServedZoneIds — unsorted refused", () => assertServedZoneIds(["ogc:zones:b:1", "ogc:zones:a:1"]));
throws("assertServedZoneIds — empty refused", () => assertServedZoneIds([]));
{
  const d = join(tmp, "served");
  mkdirSync(d, { recursive: true });
  const text = "ogc:zones:laval:A-1\n";
  writeFileSync(join(d, "served-ids.txt"), text);
  writeFileSync(join(d, "served-ids.txt.sha256"), sha256FileLine(sha(Buffer.from(text))));
  eq("readServedIdsSha — consistent artefact", readServedIdsSha(d), sha(Buffer.from(text)));
  eq("readServedIdsSha — absent artefact ⇒ null", readServedIdsSha(join(tmp, "nope")), null);
}

// ═════════════════════════════ e2e O1: served refs (restored DB → ConfigMaps) ═
const REFS_TSV = "laval\tA-1\nsutton\tZ9\nlaval\tA-1\nBad Slug\tX\nmontreal\tC408\nlaval\t\n";
{
  const p = sr.parseRefsTsv(REFS_TSV);
  eq("served-refs — rows validated, deduplicated, byte-sorted", [p.lines, p.rejected], [["laval\tA-1", "montreal\tC408", "sutton\tZ9"], 2]);
  eq("served-refs — sources parsed", sr.parseSources("geo_resolutions\t12\nzone_versions\t3400\n"), { geo_resolutions: 12, zone_versions: 3400 });
  eq("served-refs — splitParts", sr.splitParts(Buffer.alloc(10), 4).map((b) => b.length), [4, 4, 2]);
  throws("served-refs — empty result refused (fail-closed)", () => sr.buildPayload({ lines: [], rejected: 0, sources: {}, cycleId: "c1", maxParts: 4, prefix: "immo-served-refs", now: Date.now }));
}
async function refsSuite() {
  const puts = [];
  const files = { "/work/refs.tsv": REFS_TSV, "/work/sources.tsv": "zone_versions\t3\n", "/tok/token": "tkn\n", "/tok/ca.crt": "CA" };
  const env = { CYCLE_ID: "iso-prod-2026-09-27-abc", POD_NAMESPACE: "radar-immobilier-preprod", KUBE_TOKEN_DIR: "/tok", BACKUP_DATE: D };
  const r = await sr.run({ env, readFile: (p) => files[p], put: async (a) => { puts.push(a); return 200; }, log: () => {} });
  eq("served-refs run — 1 ConfigMap rewritten via the in-cluster API (token, namespace)", [r.exitCode, puts.length, puts[0].name, puts[0].token, puts[0].namespace],
    [0, 1, "immo-served-refs-0", "tkn", "radar-immobilier-preprod"]);
  const cm = puts[0].body;
  ok("served-refs run — ConfigMap: binaryData part + meta.json, bascule label", !!cm.binaryData["refs.tsv.gz.part"] && JSON.parse(cm.data["meta.json"]).rows === 3 && cm.metadata.labels["sentropic.io/bascule"] === "served-refs");
  const a = assembleRefs([cm, { data: {} }], { cycleId: env.CYCLE_ID });
  eq("assembleRefs — roundtrip (rows, sources, TSV)", [a.rows, a.meta.sources, a.tsv.toString()], [3, { zone_versions: 3 }, "laval\tA-1\nmontreal\tC408\nsutton\tZ9\n"]);
  throws("assembleRefs — ConfigMaps of another CYCLE_ID refused (stale)", () => assembleRefs([cm], { cycleId: "other" }));
  const bad = JSON.parse(JSON.stringify(cm));
  bad.binaryData["refs.tsv.gz.part"] = Buffer.from("tampered").toString("base64");
  throws("assembleRefs — tampered part refused (sha256)", () => assembleRefs([bad], { cycleId: env.CYCLE_ID }));
  // multi-part: force small parts through buildPayload + buildConfigMap
  const many = Array.from({ length: 4000 }, (_, i) => `city-${String(i).padStart(5, "0")}\tZ-${createHash("md5").update(String(i)).digest("hex")}`);
  const pay = sr.buildPayload({ lines: many, rejected: 0, sources: {}, cycleId: "c1", maxParts: 16, prefix: "immo-served-refs", now: Date.now });
  const small = sr.splitParts(Buffer.concat(pay.parts), 20000);
  const meta = { ...pay.meta, parts: small.length, names: small.map((_, i) => `immo-served-refs-${i}`) };
  const cmsMany = small.map((part, i) => sr.buildConfigMap({ namespace: "ns", name: meta.names[i], part, meta: { ...meta, part: i } }));
  eq("assembleRefs — multi-part reassembly", [small.length > 1, assembleRefs(cmsMany, { cycleId: "c1" }).rows], [true, 4000]);
  throws("served-refs — more parts than pre-created ConfigMaps refused", () => sr.buildPayload({ lines: many, rejected: 0, sources: {}, cycleId: "c1", maxParts: 0.5, prefix: "p", now: Date.now }));
  eq("refsFromTsv — gzip TSV → builder input", refsFromTsv(a.gz).zones, [{ citySlug: "laval", zoneCode: "A-1" }, { citySlug: "montreal", zoneCode: "C408" }, { citySlug: "sutton", zoneCode: "Z9" }]);
  throws("refsFromTsv — malformed line refused", () => refsFromTsv(Buffer.from("a\tb\tc\n")));
  const script = readFileSync(join(DIR, "served-refs.cjs"), "utf8");
  ok("served-refs.cjs — embeddable (no ${UPPER} sequence)", assertScriptEmbeddable(script));
  const { text, leftover } = render("served-refs-job.tmpl.yaml", { NAMESPACE: "radar-immobilier-preprod", IMAGE: "img", DUMP_IMAGE: "postgis/postgis:16-3.4",
    DB_SECRET: "radar-db-credentials", PGHOST: "radar-postgres", CYCLE_ID: "c1", BACKUP_DATE: D, REFS_CONFIGMAP_PREFIX: "immo-served-refs", REFS_CONFIGMAP_COUNT: "4",
    REFS_WRITER_SA: "radar-bascule-refs-writer", TTL_SECONDS: "3600", BR_SCRIPT: indentBlock(script, 14) });
  ok("served-refs-job — renders, no leftover", !leftover);
  ok("served-refs-job — read-only DB session (default_transaction_read_only=on)", /PGOPTIONS, value: "-c default_transaction_read_only=on"/.test(text));
  if (YAML) {
    const pod = YAML.parse(text).spec.template.spec;
    ok("served-refs-job — pod automount off, token projected into `publish` only",
      pod.automountServiceAccountToken === false && pod.serviceAccountName === "radar-bascule-refs-writer" &&
      pod.containers[0].volumeMounts.some((m) => m.name === "refs-writer") && !pod.initContainers[0].volumeMounts.some((m) => m.name === "refs-writer"));
    ok("served-refs-job — SQL reads only zone reference tables", /geo_resolutions[\s\S]*opportunity_dossiers[\s\S]*constraint_hits[\s\S]*zone_versions/.test(pod.initContainers[0].args[0]) &&
      !/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(pod.initContainers[0].args[0]));
  }
  const w = readFileSync(join(DIR, "..", "..", "..", ".github", "workflows", "bascule-preprod.yml"), "utf8");
  ok("workflow — served refs step after S7, CYCLE_ID + not DRY + not list", /id: served_refs\n\s+if: \$\{\{ !inputs\.DRY_RUN && env\.MODE != 'list' && env\.CYCLE_ID != '' \}\}\n\s+run: node "\$CLI" served-refs/.test(w) &&
    w.indexOf('node "$CLI" served-refs') > w.indexOf('node "$CLI" smoke'));
  ok("workflow — served-ids job consumes the immo-served-refs artefact", /name: immo-served-refs-\$\{\{ inputs\.CYCLE_ID \}\}\n\s+path: \$\{\{ runner\.temp \}\}\/served-refs/.test(w) && /IMMO_SERVED_REFS_FILE: \$\{\{ runner\.temp \}\}\/served-refs\/immo-served-refs\.tsv\.gz/.test(w));
  ok("workflow — no dependency on vars.BASCULE_IMMO_SERVED_REFS_URL", !/IMMO_SERVED_REFS_URL/.test(w));
}

// ═════════════════════════════ runner CLI end-to-end (fake kubectl) ═══════════
// The real bascule.mjs subcommands against a fake `kubectl` (bash, temp dir):
// Jobs succeed, pods carry the termination messages produced by the in-pod
// steps above. Proves the wiring R0 → S2 → S3' → S3b' → S5 (G4) and what the
// runner renders/records, with 0 cluster.
async function cliSuite() {
  const { s, manSha, dump } = fixture();
  const resolved = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: "latest" }) });
  const docsVerdict = { ok: true, step: "docs", date: D, copied: 2, recon: { ok: true } };
  const bin = join(tmp, "fakebin");
  mkdirSync(bin, { recursive: true });
  // Every applied Job gets JOB_UID; each pod list also holds a NEWER pod of a
  // previous instance (other uid) whose verdict must never be read.
  const JOB_UID = "22222222-2222-4222-8222-222222222222";
  const podOf = (uid, ts, container, msg) => ({ metadata: { creationTimestamp: ts, ownerReferences: [{ kind: "Job", uid, controller: true }] },
    status: { initContainerStatuses: container === "fetch" ? [{ name: "fetch", state: { terminated: { message: msg } } }] : [],
      containerStatuses: container === "fetch" ? [] : [{ name: container, state: { terminated: { message: msg } } }] } });
  const pods = (container, msg) => JSON.stringify({ items: [podOf(JOB_UID, "2026-09-26T12:00:00Z", container, msg),
    podOf("99999999-9999-4999-8999-999999999999", "2026-09-26T13:00:00Z", container, '{"ok":false,"reason":"stale pod of a previous instance"}')] });
  writeFileSync(join(tmp, "pods-read.json"), pods("read", JSON.stringify(resolved.t)));
  writeFileSync(join(tmp, "pods-fetch.json"), pods("fetch", JSON.stringify({ ok: true, step: "fetch-dump", date: D })));
  writeFileSync(join(tmp, "pods-docs.json"), pods("docs", JSON.stringify(docsVerdict)));
  // what the served-refs Job would have published for this CYCLE_ID
  const CLI_CYCLE = "iso-prod-2026-09-27-cli";
  const refsPuts = [];
  await sr.run({ env: { CYCLE_ID: CLI_CYCLE, POD_NAMESPACE: "radar-immobilier-preprod", KUBE_TOKEN_DIR: "/tok" },
    readFile: (p) => ({ "/work/refs.tsv": REFS_TSV, "/work/sources.tsv": "", "/tok/token": "t", "/tok/ca.crt": "c" })[p] ?? "",
    put: async (a) => { refsPuts.push(a); return 200; }, log: () => {} });
  writeFileSync(join(tmp, "cm-refs-0.json"), JSON.stringify(refsPuts[0].body));
  const kubectlLog = join(tmp, "kubectl.log");
  writeFileSync(join(bin, "kubectl"), [
    "#!/usr/bin/env bash",
    `echo "$*" >> "${kubectlLog}"`,
    'case "$*" in',
    '  *"containers[0].image"*) printf "ghcr.io/rhanka/radar-api@sha256:%064d" 0 ;;',
    '  *"jsonpath={.spec.replicas}"*|*"jsonpath={.status.replicas}"*) printf 0 ;;',
    '  *"jsonpath={.spec.suspend}"*) printf true ;;',
    '  *"get cronjob"*"-o name"*) printf "cronjob/x" ;;',
    '  *"get jobs -o json"*) printf \'{"items":[]}\' ;;',
    '  *"get job "*"jsonpath={.status}"*) printf \'{"succeeded":1}\' ;;',
    `  *"get job "*"jsonpath={.metadata.uid}"*) printf "${JOB_UID}" ;;`,
    `  *"job-name=${JOBS.resolve}"*) cat "${join(tmp, "pods-read.json")}" ;;`,
    `  *"job-name=${JOBS.db}"*) cat "${join(tmp, "pods-fetch.json")}" ;;`,
    `  *"job-name=${JOBS.docs}"*|*"job-name=${JOBS.recon}"*) cat "${join(tmp, "pods-docs.json")}" ;;`,
    `  *"get configmap immo-served-refs-0 -o json"*) cat "${join(tmp, "cm-refs-0.json")}" ;;`,
    '  *"get configmap immo-served-refs-"*) printf \'{"data":{}}\' ;;',
    "  *) : ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });
  const work = join(tmp, "cli-work");
  const out = join(tmp, "gh-output");
  writeFileSync(out, "");
  const env = {
    PATH: `${bin}:${process.env.PATH}`, MODE: "restore", BACKUP_ID: "latest", BHS: "s3.bhs.io.cloud.ovh.net", S3_REGION: "bhs",
    EXPECTED_DATABASE: "radar", PREPROD_DOCS: DST, PROD_DOCS: PROD, DUMP_BUCKET: "radar-immobilier-backups-preprod",
    CONFIRM: `iso-prod-${new Date().toISOString().slice(0, 10)}`, CONFIRM_EXPECTED: `iso-prod-${new Date().toISOString().slice(0, 10)}`,
    BASCULE_WORKDIR: work, GITHUB_OUTPUT: out, DOCS_SYNC_GRANTEE: "1901410700457444:user-x", QUIESCE_TIMEOUT: "5",
  };
  const cli = (cmd) => spawnSync(process.execPath, [join(DIR, "bascule.mjs"), cmd], { env, encoding: "utf8" });
  const pre = cli("preflight-backup");
  eq("CLI preflight-backup — exit 0", pre.status, 0);
  const r0 = cli("backup-resolve");
  eq("CLI backup-resolve — exit 0", r0.status, 0);
  const pin = JSON.parse(readFileSync(join(work, "backup-pin.json"), "utf8"));
  eq("CLI backup-resolve — backup-pin.json pinned", [pin.date, pin.manifestSha256 === manSha, pin.pgSha256 === sha(dump)], [D, true, true]);
  ok("CLI backup-resolve — GITHUB_OUTPUT backup_date", readFileSync(out, "utf8").includes(`backup_date=${D}\n`));
  const rr = readFileSync(join(work, `${JOBS.resolve}.rendered.yaml`), "utf8");
  ok("CLI backup-resolve — rendered Job carries BACKUP_ID + reader Secret, no leftover", /BACKUP_ID, value: "latest"/.test(rr) && /name: radar-backup-reader-preprod, key: S3_ACCESS_KEY/.test(rr) && !/\$\{[A-Z0-9_]+\}/.test(rr));
  if (YAML) ok("CLI backup-resolve — rendered Job is valid YAML", YAML.parse(rr).kind === "Job");
  const s2 = cli("restore-backup");
  eq("CLI restore-backup — exit 0 (G2 + G1 + Job)", s2.status, 0);
  const rd = readFileSync(join(work, `${JOBS.db}.rendered.yaml`), "utf8");
  ok("CLI restore-backup — Job pinned to D + manifest/dump sha256", rd.includes(`value: "${D}"`) && rd.includes(manSha) && rd.includes(sha(dump)));
  ok("CLI restore-backup — G1 rollback Job dispatched before the restore", (() => { const l = readFileSync(kubectlLog, "utf8"); return l.indexOf("radar-db-rollback-bascule") > -1 && l.indexOf("radar-db-rollback-bascule") < l.indexOf(JOBS.db); })());
  ok("CLI restore-backup — never a live dump / PROD kubeconfig", !/radar-db-backup-prod|--kubeconfig/.test(readFileSync(kubectlLog, "utf8")));
  eq("CLI docs-restore — exit 0", cli("docs-restore").status, 0);
  const rdoc = readFileSync(join(work, `${JOBS.docs}.rendered.yaml`), "utf8");
  ok("CLI docs-restore — prod docs + backup bucket forbidden, preprod target, grant", rdoc.includes(`FORBIDDEN_DST_BUCKETS, value: "${PROD},${B}"`) && rdoc.includes(`DST_BUCKET, value: "${DST}"`) && rdoc.includes("user-x"));
  const noProd = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "preflight-backup"], { env: { ...env, PROD_DOCS: "" }, encoding: "utf8" });
  ok("CLI preflight-backup (restore) — PROD_DOCS absent ⇒ refused", noProd.status === 1 && /PROD_DOCS/.test(noProd.stdout));
  const intoProd = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "preflight-backup"], { env: { ...env, PROD_DOCS: "some-other-prod", PREPROD_DOCS: PROD }, encoding: "utf8" });
  ok("CLI preflight-backup (restore) — PREPROD_DOCS = frozen prod docs bucket ⇒ refused", intoProd.status === 1 && /forbidden destination/.test(intoProd.stdout));
  eq("CLI recon-backup — exit 0 + sentinel", [cli("recon-backup").status, JSON.parse(readFileSync(join(work, "recon.ok.json"), "utf8")).backupDate], [0, D]);
  const flip = cli("flip");
  eq("CLI flip — G4 = recon vs inventory(D) re-run, exit 0", flip.status, 0);
  ok("CLI flip — set env issued after the recon re-run", /set env deploy\/radar-api GEO_DOCUMENTS_REPOINT-/.test(readFileSync(kubectlLog, "utf8")));
  const bad = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-resolve"], { env: { ...env, BACKUP_ID: "2026-99-01" }, encoding: "utf8" });
  ok("CLI backup-resolve — malformed BACKUP_ID refused before any kubectl", bad.status === 1 && /BACKUP_ID must be/.test(bad.stdout));
  const wrongMode = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "restore-backup"], { env: { ...env, MODE: "chain" }, encoding: "utf8" });
  eq("CLI restore-backup — refused in MODE=chain", wrongMode.status, 1);
  const secretFill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "docs-secret-fill"], { env: { ...env, RADAR_DOCS_SYNC_ACCESS_KEY: "0".repeat(32), RADAR_DOCS_SYNC_SECRET_KEY: "f".repeat(40) }, encoding: "utf8" });
  const klog = readFileSync(kubectlLog, "utf8");
  ok("CLI docs-secret-fill — dry-run=server then replace, values never in argv/stdout",
    secretFill.status === 0 && /replace --dry-run=server -f \S+ -o name/.test(klog) && /replace -f \S+ -o name/.test(klog) &&
    !klog.includes("f".repeat(40)) && !secretFill.stdout.includes("f".repeat(40)));
  const noSecret = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "docs-secret-fill"], { env, encoding: "utf8" });
  ok("CLI docs-secret-fill — GitHub secret absent ⇒ fail-closed", noSecret.status === 1 && /missing or malformed/.test(noSecret.stdout));
  const before = readFileSync(kubectlLog, "utf8").length;
  const check = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "docs-secret-fill", "--check"], { env: { ...env, RADAR_DOCS_SYNC_ACCESS_KEY: "0".repeat(32), RADAR_DOCS_SYNC_SECRET_KEY: "f".repeat(40) }, encoding: "utf8" });
  const klogCheck = readFileSync(kubectlLog, "utf8").slice(before);
  ok("CLI docs-secret-fill --check (DRY) — server dry-run only, no write", check.status === 0 && /replace --dry-run=server -f/.test(klogCheck) && !/replace -f/.test(klogCheck));
  // G3 in every MODE, before any Secret write or Job (list included)
  const g3env = { ...env, CONFIRM: "iso-prod-2020-01-01" };
  const beforeG3 = readFileSync(kubectlLog, "utf8").length;
  const g3list = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "preflight-backup"], { env: { ...g3env, MODE: "list" }, encoding: "utf8" });
  const g3fill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-secrets-fill"], { env: { ...g3env, MODE: "list",
    RADAR_BACKUP_READER_PREPROD_ACCESS_KEY: "a".repeat(32), RADAR_BACKUP_READER_PREPROD_SECRET_KEY: "b".repeat(32) }, encoding: "utf8" });
  const g3job = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-list"], { env: { ...g3env, MODE: "list" }, encoding: "utf8" });
  const g3cmd = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "confirm"], { env: g3env, encoding: "utf8" });
  ok("CLI G3 — stale CONFIRM refused in MODE=list: preflight, Secret write, Job, confirm step — 0 kubectl call",
    [g3list, g3fill, g3job, g3cmd].every((r) => r.status === 1 && /GARDE G3/.test(r.stdout)) && readFileSync(kubectlLog, "utf8").length === beforeG3);
  eq("CLI confirm — today's CONFIRM accepted", spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "confirm"], { env, encoding: "utf8" }).status, 0);
  // un-quiesce: nothing recorded ⇒ nothing scaled (unless a declared manual quiesce)
  const uqEnv = { ...env, BASCULE_WORKDIR: join(tmp, "uq-work"), UNQUIESCE_REPLICAS: "radar-api=2" };
  const beforeUq = readFileSync(kubectlLog, "utf8").length;
  const uq = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "unquiesce"], { env: uqEnv, encoding: "utf8" });
  ok("CLI unquiesce — no quiesce recorded, SKIP_QUIESCE≠true ⇒ no-op (0 scale)", uq.status === 0 && !/scale/.test(readFileSync(kubectlLog, "utf8").slice(beforeUq)));
  const uqManual = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "unquiesce"], { env: { ...uqEnv, SKIP_QUIESCE: "true" }, encoding: "utf8" });
  ok("CLI unquiesce — declared manual quiesce (SKIP_QUIESCE=true) ⇒ UNQUIESCE_REPLICAS applied", uqManual.status === 0 && /scale deploy\/radar-api --replicas=2/.test(readFileSync(kubectlLog, "utf8").slice(beforeUq)));
  // failure-summary: reads the workdir pointers of this run (PIN of D)
  const sumFile = join(tmp, "summary.md");
  writeFileSync(sumFile, "");
  const fs1 = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "failure-summary"], { env: { ...env, GITHUB_STEP_SUMMARY: sumFile,
    O_MIGRATE: "success", O_DOCS: "failure", O_RECON: "skipped", O_FLIP: "skipped", O_UNQUIESCE: "success", O_SMOKE: "success" }, encoding: "utf8" });
  ok("CLI failure-summary — day D from the PIN, docs/flip incomplete, G1 key, written to the step summary",
    fs1.status === 0 && readFileSync(sumFile, "utf8").includes(`day D = ${D} (backup) — docs/flip INCOMPLETE`) && /DUMP_PREFIX=rollback\/preprod-rollback-/.test(readFileSync(sumFile, "utf8")));
  const h = (c) => c.repeat(32);
  const backupFill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-secrets-fill"], { env: { ...env,
    RADAR_BACKUP_READER_PREPROD_ACCESS_KEY: h("a"), RADAR_BACKUP_READER_PREPROD_SECRET_KEY: h("b"), RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY: h("c"), RADAR_BACKUP_RESTORE_DOCS_SECRET_KEY: h("d") }, encoding: "utf8" });
  const klog2 = readFileSync(kubectlLog, "utf8");
  ok("CLI backup-secrets-fill (restore) — reader-preprod + restore-docs replaced, values never in argv/stdout",
    backupFill.status === 0 && /get secret radar-backup-reader-preprod/.test(klog2) && /get secret radar-backup-restore-docs/.test(klog2) &&
    !["a", "b", "c", "d"].some((c) => klog2.includes(h(c)) || backupFill.stdout.includes(h(c))));
  const listFill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-secrets-fill"], { env: { ...env, MODE: "list",
    RADAR_BACKUP_READER_PREPROD_ACCESS_KEY: h("a"), RADAR_BACKUP_READER_PREPROD_SECRET_KEY: h("b") }, encoding: "utf8" });
  ok("CLI backup-secrets-fill (list) — reader only, copy-signer secrets not required", listFill.status === 0);
  const refs = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "served-refs"], { env: { ...env, CYCLE_ID: CLI_CYCLE }, encoding: "utf8" });
  const got = readFileSync(join(work, "served-refs", "immo-served-refs.tsv.gz"));
  eq("CLI served-refs — Job + ConfigMaps reassembled into the artefact file", [refs.status, refsFromTsv(got).zones.length], [0, 3]);
  ok("CLI served-refs — rendered Job read-only + refs writer SA", /default_transaction_read_only=on/.test(readFileSync(join(work, "radar-bascule-served-refs.rendered.yaml"), "utf8")) &&
    /serviceAccountName: radar-bascule-refs-writer/.test(readFileSync(join(work, "radar-bascule-served-refs.rendered.yaml"), "utf8")));
  const stale = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "served-refs"], { env: { ...env, CYCLE_ID: "another-cycle" }, encoding: "utf8" });
  ok("CLI served-refs — ConfigMaps of another cycle ⇒ fail-closed", stale.status === 1 && /another CYCLE_ID/.test(stale.stdout));
}

await suite();
await refsSuite();
await cliSuite();
console.log(`\nrestore-mode.selftest — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
