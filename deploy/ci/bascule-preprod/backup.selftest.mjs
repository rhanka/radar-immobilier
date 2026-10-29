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
eq("basculeMode — default restore", basculeMode({}), "restore");
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
}

await suite();
await refsSuite();
console.log(`\nbackup.selftest — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
