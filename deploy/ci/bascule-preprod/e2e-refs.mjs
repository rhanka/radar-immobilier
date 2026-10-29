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
import { gunzipSync } from "node:zlib";


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
