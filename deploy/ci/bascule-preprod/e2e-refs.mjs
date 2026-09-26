// =============================================================================
// e2e-refs.mjs — runner side of O1: the zone references immo holds, read from
// the RESTORED preprod database by the Job radar-bascule-served-refs (read-only
// psql + served-refs.cjs), published through the pre-created ConfigMaps
// immo-served-refs-0..N-1 and reassembled here with `kubectl get configmap`
// (configmaps get on those names). No pods/log, no S3 credential.
//
//   served-refs   after S7 (CYCLE_ID set, not DRY, MODE chain|restore): dispatch
//                 the Job, wait (.status), read + verify the ConfigMaps (CYCLE_ID,
//                 part indexes, sha256 of the gzip and of the TSV, row count) and
//                 write .bascule-work/served-refs/immo-served-refs.tsv.gz + meta.json,
//                 uploaded as artefact immo-served-refs-<CYCLE_ID> for the job
//                 `served-ids` (which has no cluster credential).
// =============================================================================
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

import { assertScriptEmbeddable, assertYamlSafeVars, indentBlock, validateCycleId } from "./restore-mode.mjs";

export const REFS_FORMAT = "immo-served-refs/v1";
export const REFS_JOB = "radar-bascule-served-refs";
export const PART_KEY = "refs.tsv.gz.part";
export const META_KEY = "meta.json";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// ConfigMaps (kubectl get -o json objects, in part order) → verified gzip + TSV.
export function assembleRefs(configMaps, { cycleId }) {
  if (!Array.isArray(configMaps) || !configMaps.length) throw new Error("no served-refs ConfigMap");
  let meta0;
  try { meta0 = JSON.parse(configMaps[0]?.data?.[META_KEY] ?? ""); } catch { throw new Error("served-refs meta.json unreadable"); }
  if (meta0.format !== REFS_FORMAT) throw new Error("served-refs meta.json has an unknown format");
  if (meta0.cycleId !== cycleId) throw new Error("served-refs ConfigMaps belong to another CYCLE_ID (stale): re-run");
  const parts = Number(meta0.parts);
  if (!Number.isInteger(parts) || parts < 1 || configMaps.length < parts) throw new Error("served-refs parts missing");
  const bufs = [];
  for (let i = 0; i < parts; i++) {
    let m;
    try { m = JSON.parse(configMaps[i]?.data?.[META_KEY] ?? ""); } catch { m = null; }
    if (!m || m.cycleId !== cycleId || m.part !== i || m.gzipSha256 !== meta0.gzipSha256) throw new Error(`served-refs part ${i} inconsistent`);
    const b64 = configMaps[i]?.binaryData?.[PART_KEY];
    if (typeof b64 !== "string") throw new Error(`served-refs part ${i} has no ${PART_KEY}`);
    bufs.push(Buffer.from(b64, "base64"));
  }
  const gz = Buffer.concat(bufs);
  if (sha256(gz) !== meta0.gzipSha256) throw new Error("served-refs gzip sha256 differs from meta.json");
  const tsv = gunzipSync(gz);
  if (sha256(tsv) !== meta0.tsvSha256) throw new Error("served-refs TSV sha256 differs from meta.json");
  const rows = tsv.toString("utf8").split("\n").filter(Boolean).length;
  if (rows !== Number(meta0.rows) || rows === 0) throw new Error("served-refs row count differs from meta.json (or empty)");
  const { part: _part, ...meta } = meta0;
  return { gz, tsv, meta, rows };
}

export function makeE2eRefs(h) {
  const { log, die, section, run, opt, runJobFromTemplate, jobDefaults, workdir, resolvePreprodImage } = h;

  function cmdServedRefs() {
    section("e2e O1 — served refs: Job read-only on the restored DB → ConfigMaps → artefact");
    let cycleId;
    try { cycleId = validateCycleId(opt("CYCLE_ID", "")); } catch (e) { die(e.message); }
    if (!cycleId) die("served-refs requires CYCLE_ID.");
    const mode = opt("MODE", "chain");
    if (!["chain", "restore"].includes(mode)) die("served-refs runs in MODE=chain|restore only.");
    const jd = jobDefaults();
    const ns = jd.NAMESPACE;
    const prefix = opt("REFS_CONFIGMAP_PREFIX", "immo-served-refs");
    const count = Math.max(1, Math.min(16, Number(opt("REFS_CONFIGMAP_COUNT", "4")) || 4));
    const sa = opt("REFS_WRITER_SA", "radar-bascule-refs-writer");
    if (!K8S_NAME_RE.test(`${prefix}-${count - 1}`) || !K8S_NAME_RE.test(sa)) die("REFS_CONFIGMAP_PREFIX / REFS_WRITER_SA invalid");
    let backupDate = "";
    const pinPath = join(workdir(), "backup-pin.json");
    if (mode === "restore" && existsSync(pinPath)) {
      try { backupDate = JSON.parse(readFileSync(pinPath, "utf8")).date || ""; } catch { backupDate = ""; }
    }
    const script = readFileSync(join(import.meta.dirname, "served-refs.cjs"), "utf8");
    const vars = {
      NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), DUMP_IMAGE: jd.DUMP_IMAGE, DB_SECRET: jd.DB_SECRET, PGHOST: jd.PGHOST,
      CYCLE_ID: cycleId, BACKUP_DATE: backupDate, REFS_CONFIGMAP_PREFIX: prefix, REFS_CONFIGMAP_COUNT: String(count),
      REFS_WRITER_SA: sa, TTL_SECONDS: jd.TTL_SECONDS,
    };
    try { assertScriptEmbeddable(script); assertYamlSafeVars(vars); } catch (e) { die(e.message); }
    runJobFromTemplate({ tmpl: "served-refs-job.tmpl.yaml", jobName: REFS_JOB, vars: { ...vars, BR_SCRIPT: indentBlock(script, 14) },
      timeoutSec: Number(opt("SERVED_REFS_TIMEOUT", "900")) });
    const cms = [];
    for (let i = 0; i < count; i++) {
      const r = run("kubectl", ["-n", ns, "get", "configmap", `${prefix}-${i}`, "-o", "json"], { capture: true, allowFail: true });
      if (r.status !== 0) {
        if (i === 0) die(`ConfigMap ${ns}/${prefix}-0 not readable: pre-created by k8s, configmaps get granted by name to the bascule SA (see README).`);
        break;
      }
      try { cms.push(JSON.parse(r.stdout)); } catch { die(`ConfigMap ${prefix}-${i} unreadable`); }
    }
    let out;
    try { out = assembleRefs(cms, { cycleId }); } catch (e) { die(`served-refs — ${e.message}`); }
    const dir = join(workdir(), "served-refs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "immo-served-refs.tsv.gz"), out.gz, { mode: 0o644 });
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(out.meta, null, 2)}\n`, { mode: 0o644 });
    log(`served-refs OK — ${out.rows} (city_slug, zone_code) couples, sources ${JSON.stringify(out.meta.sources)}, ` +
      `rejected ${out.meta.rejected}, gzip sha256 ${out.meta.gzipSha256} (${out.meta.parts} ConfigMap(s)).`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### e2e served refs (immo)\n\n${out.rows} couples · sources ${JSON.stringify(out.meta.sources)}\n`, { flag: "a" });
    }
  }

  return { commands: { "served-refs": cmdServedRefs } };
}
