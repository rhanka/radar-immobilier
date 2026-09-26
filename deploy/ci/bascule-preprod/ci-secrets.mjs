// =============================================================================
// ci-secrets.mjs — the bascule WRITES its in-cluster Secrets itself, from GitHub.
//
// Owner rule (2026-09-26): no k8s watcher, no SealedSecret. Each Secret below is
// PRE-CREATED by k8s (Opaque, no ownerReference) in radar-immobilier-preprod and
// REWRITTEN by the bascule at every run, right before first use, from the
// secrets of the GitHub environment `radar-bascule` (main-only):
//
//   spec                 Secret (default name)          keys ← GitHub secret
//   docs-sync            radar-docs-src-preprod         S3_ACCESS_KEY ← RADAR_DOCS_SYNC_ACCESS_KEY
//                                                       S3_SECRET_KEY ← RADAR_DOCS_SYNC_SECRET_KEY
//   backup-reader        radar-backup-reader-preprod    S3_ACCESS_KEY ← RADAR_BACKUP_READER_PREPROD_ACCESS_KEY
//                                                       S3_SECRET_KEY ← RADAR_BACKUP_READER_PREPROD_SECRET_KEY
//                                                       BACKUP_BUCKET ← fixed value (var, validated)
//   backup-restore-docs  radar-backup-restore-docs      S3_ACCESS_KEY ← RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY
//                                                       S3_SECRET_KEY ← RADAR_BACKUP_RESTORE_DOCS_SECRET_KEY
//                                                       BACKUP_BUCKET ← fixed value (var, validated)
//
// Mechanism (CI rights: secrets get + update by resourceNames only —
// rbac-ci-bascule-preprod-docs-secret.yaml; never create/apply/patch):
//   - key values guarded by ^[0-9a-f]{32,64}$, fail-closed before any kubectl;
//   - `kubectl get` of labels/annotations, then `kubectl replace
//     --dry-run=server -f` and `kubectl replace -f` of a JSON manifest written 0600
//     in a 0700 temp dir (removed in `finally`);
//   - values only from the step `env:` (never interpolated in `run:`), never in
//     argv or logs; kubectl output captured, a redacted first line on failure.
// Durable least-privilege credentials: not blanked after the run (a crashed run
// never leaves an empty Secret).
// =============================================================================
import { Buffer } from "node:buffer";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export const VALUE_RE = /^[0-9a-f]{32,64}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const DROPPED_ANNOTATIONS = Object.freeze(["kubectl.kubernetes.io/last-applied-configuration"]);

// Secret keys ← GitHub secret names. Adjust HERE if k8s changes a key or a name.
export const SECRET_SPECS = Object.freeze({
  "docs-sync": Object.freeze({
    nameEnv: "DOCS_SYNC_READ_SECRET", defaultName: "radar-docs-src-preprod",
    keys: Object.freeze({ S3_ACCESS_KEY: "RADAR_DOCS_SYNC_ACCESS_KEY", S3_SECRET_KEY: "RADAR_DOCS_SYNC_SECRET_KEY" }),
    fixed: Object.freeze({}),
  }),
  "backup-reader": Object.freeze({
    nameEnv: "BACKUP_READER_SECRET", defaultName: "radar-backup-reader-preprod",
    keys: Object.freeze({ S3_ACCESS_KEY: "RADAR_BACKUP_READER_PREPROD_ACCESS_KEY", S3_SECRET_KEY: "RADAR_BACKUP_READER_PREPROD_SECRET_KEY" }),
    fixed: Object.freeze({ BACKUP_BUCKET: { env: "BACKUP_BUCKET", default: "radar-immobilier-backup", re: BUCKET_RE } }),
  }),
  "backup-restore-docs": Object.freeze({
    nameEnv: "BACKUP_DOCS_COPY_SECRET", defaultName: "radar-backup-restore-docs",
    keys: Object.freeze({ S3_ACCESS_KEY: "RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY", S3_SECRET_KEY: "RADAR_BACKUP_RESTORE_DOCS_SECRET_KEY" }),
    // same key set as the pre-created Secret (k8s): kept on replace.
    fixed: Object.freeze({ BACKUP_BUCKET: { env: "BACKUP_BUCKET", default: "radar-immobilier-backup", re: BUCKET_RE } }),
  }),
});
// Kept for the docs-sync callers/tests.
export const DOCS_SYNC_SECRET_KEYS = SECRET_SPECS["docs-sync"].keys;

// Secret values of a spec from the env; fail-closed on a missing or malformed
// GitHub secret or fixed value (the error names it, never its value).
export function secretValuesFromEnv(env, keys = DOCS_SYNC_SECRET_KEYS, fixed = {}) {
  const bad = [];
  const values = {};
  for (const [key, envName] of Object.entries(keys)) {
    const v = String(env[envName] ?? "").replace(/[\r\n]+$/, "");
    if (!VALUE_RE.test(v)) bad.push(envName);
    else values[key] = v;
  }
  for (const [key, f] of Object.entries(fixed)) {
    const v = String(env[f.env] ?? "").trim() || f.default;
    if (!f.re.test(v)) bad.push(f.env);
    else values[key] = v;
  }
  if (bad.length) throw new Error(`value(s) ${bad.join(", ")} missing or malformed (GitHub environment radar-bascule) — nothing written`);
  return values;
}

export function secretNameFor(spec, env) {
  const s = SECRET_SPECS[spec];
  if (!s) throw new Error(`unknown secret spec ${spec}`);
  const name = String(env[s.nameEnv] ?? "").trim() || s.defaultName;
  if (!K8S_NAME_RE.test(name)) throw new Error(`${s.nameEnv} is not a valid Secret name`);
  return name;
}

// Specs written for a MODE (docs-sync: chain; backup reader: list + restore;
// copy signer: restore).
export function specsForMode(mode) {
  if (mode === "chain") return ["docs-sync"];
  if (mode === "list") return ["backup-reader"];
  if (mode === "restore") return ["backup-reader", "backup-restore-docs"];
  throw new Error(`unknown MODE ${mode}`);
}

export function buildSecretManifest({ name, namespace, values, labels = {}, annotations = {} }) {
  if (!K8S_NAME_RE.test(String(name))) throw new Error("invalid Secret name");
  if (!K8S_NAME_RE.test(String(namespace))) throw new Error("invalid namespace");
  const ann = Object.fromEntries(Object.entries(annotations || {}).filter(([k]) => !DROPPED_ANNOTATIONS.includes(k)));
  const metadata = { name, namespace };
  if (labels && Object.keys(labels).length) metadata.labels = labels;
  if (Object.keys(ann).length) metadata.annotations = ann;
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata,
    type: "Opaque",
    data: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Buffer.from(String(v), "utf8").toString("base64")])),
  };
}

export function redact(text, values) {
  let out = String(text ?? "");
  for (const v of Object.values(values || {})) {
    if (!v || !VALUE_RE.test(v)) continue; // only the secret key values (a bucket name is not secret)
    for (const s of [v, Buffer.from(v, "utf8").toString("base64")]) out = out.split(s).join("***");
  }
  return out;
}

export function parseJsonObject(text) {
  try {
    const v = JSON.parse(String(text ?? "").trim() || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function writePrivateManifest(manifest) {
  const dir = mkdtempSync(join(tmpdir(), "bascule-secret-"));
  chmodSync(dir, 0o700);
  const file = join(dir, "secret.json");
  writeFileSync(file, JSON.stringify(manifest), { mode: 0o600 });
  return { file, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function makeCiSecrets(h) {
  const { log, die, section, run, jobDefaults } = h;

  function writeSecret(spec) {
    const s = SECRET_SPECS[spec];
    let values;
    let name;
    try {
      values = secretValuesFromEnv(process.env, s.keys, s.fixed);
      name = secretNameFor(spec, process.env);
    } catch (e) { die(`${spec} — ${e.message}`); }
    const ns = jobDefaults().NAMESPACE;
    const lab = run("kubectl", ["-n", ns, "get", "secret", name, "-o", "jsonpath={.metadata.labels}"], { capture: true, allowFail: true });
    if (lab.status !== 0) {
      die(`${spec} — Secret ${ns}/${name} not readable: it must be PRE-CREATED (k8s) with get/update granted by name to the bascule SA.`);
    }
    const ann = run("kubectl", ["-n", ns, "get", "secret", name, "-o", "jsonpath={.metadata.annotations}"], { capture: true, allowFail: true });
    const manifest = buildSecretManifest({
      name, namespace: ns, values, labels: parseJsonObject(lab.stdout), annotations: ann.status === 0 ? parseJsonObject(ann.stdout) : {},
    });
    const tmp = writePrivateManifest(manifest);
    try {
      for (const pass of [["--dry-run=server"], []]) {
        const r = run("kubectl", ["-n", ns, "replace", ...pass, "-f", tmp.file, "-o", "name"], { capture: true, allowFail: true });
        if (r.status !== 0) {
          const first = redact(String(r.stderr || "").split("\n")[0], values).slice(0, 240);
          die(`${spec} — kubectl replace${pass.length ? " --dry-run=server" : ""} failed on ${ns}/${name}: ${first}`);
        }
      }
    } finally {
      tmp.cleanup();
    }
    log(`${spec} OK — Secret ${ns}/${name} rewritten (keys ${Object.keys(values).join(", ")}; values never printed).`);
  }

  function cmdDocsFill() {
    section("S3.0 docs-sync Secret — rewrite from GitHub (environment radar-bascule)");
    writeSecret("docs-sync");
  }

  function cmdBackupFill() {
    const mode = String(process.env.MODE || "chain").trim();
    let specs;
    try { specs = specsForMode(mode); } catch (e) { die(e.message); }
    if (mode === "chain") die("backup-secrets-fill is for MODE=restore|list.");
    section(`backup Secrets — rewrite from GitHub (environment radar-bascule): ${specs.join(", ")}`);
    for (const spec of specs) writeSecret(spec);
  }

  return { commands: { "docs-secret-fill": cmdDocsFill, "backup-secrets-fill": cmdBackupFill } };
}
