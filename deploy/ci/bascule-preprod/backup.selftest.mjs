// Offline backup primitives: versioned S3, pinned restoration, additive documents,
// pure validators and the preserved cross-tenant artifact contracts. No cluster calls.
import { Buffer } from "node:buffer";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  assertScriptEmbeddable, assertYamlSafeVars, basculeMode, forbiddenDstBuckets, formatBackupTable, FROZEN_PROD_DOCS_BUCKETS, indentBlock, JOBS,
  parseTermination, pickTerminationMessage, podOfJob, safeReason, validateBackupIdInput, validateCycleId, validateListing, validatePin,
} from "./backup-utils.mjs";
import {
  assertServedZoneIds, buildImmoLeg, combine, immoVerdict, mapOutcome, normalizeRawRefs, readServedIdsSha,
  servedIdsArtifactName, cycleLegArtifactName, sha256FileLine, refsFromTsv,
} from "./served-ids.mjs";
import { assembleRefs } from "./e2e-refs.mjs";

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
