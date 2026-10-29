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
