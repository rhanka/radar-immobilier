// =============================================================================
// docs-sync-secret.mjs — the bascule WRITES the docs-sync Secret itself.
//
// Owner rule (2026-09-26): the S3 docs copy reads the Secret
// `radar-docs-src-preprod` (ns radar-immobilier-preprod, identity immo-docs-prod:
// read-only on the prod docs, write without delete on the preprod docs). It is no
// longer created by a k8s watcher (a scheduled run failed on S3 when nobody
// created it). Instead, `docs-secret-fill`, right before S3, REWRITES it at every
// run from the GitHub secrets of the environment `radar-bascule` (main-only):
//   - PRE-CREATED Opaque Secret (k8s), no ownerReference; CI rights on it:
//     get + update, by name (rbac-ci-bascule-preprod-docs-secret.yaml);
//   - `kubectl replace --dry-run=server` then `kubectl replace`;
//   - values guarded by ^[0-9a-f]{32,64}$, fail-closed before any kubectl call;
//   - the values never appear in argv or logs: read from the step `env:` (never
//     interpolated in `run:`), written to a 0600 file in a 0700 temp dir, passed
//     with `-f`, file removed in `finally`; kubectl output captured, only a
//     redacted first line printed on failure.
// The credential is durable and least-privilege, so it is NOT blanked at the end
// (a crashed run never leaves an empty Secret). Never a SealedSecret.
// =============================================================================
import { Buffer } from "node:buffer";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// Secret key → GitHub secret (env var) name. Keys = the ONLY ones the docs-sync
// Job reads (docs-sync-job.tmpl.yaml). Adjust HERE if k8s changes them.
export const DOCS_SYNC_SECRET_KEYS = Object.freeze({
  S3_ACCESS_KEY: "RADAR_DOCS_SYNC_ACCESS_KEY",
  S3_SECRET_KEY: "RADAR_DOCS_SYNC_SECRET_KEY",
});
export const VALUE_RE = /^[0-9a-f]{32,64}$/;
export const DROPPED_ANNOTATIONS = Object.freeze(["kubectl.kubernetes.io/last-applied-configuration"]);
const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Values from the step env; fail-closed on a missing or malformed GitHub secret
// (the error names the secret, never its value).
export function secretValuesFromEnv(env, keys = DOCS_SYNC_SECRET_KEYS) {
  const bad = [];
  const values = {};
  for (const [key, envName] of Object.entries(keys)) {
    const v = String(env[envName] ?? "").replace(/[\r\n]+$/, "");
    if (!VALUE_RE.test(v)) bad.push(envName);
    else values[key] = v;
  }
  if (bad.length) {
    throw new Error(`GitHub secret(s) ${bad.join(", ")} missing or not ${VALUE_RE} (environment radar-bascule) — nothing written`);
  }
  return values;
}

// Full Secret object for `kubectl replace` (JSON). Labels/annotations of the
// pre-created Secret are kept; no ownerReferences.
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

// Remove every secret value (raw and base64) from a text before printing it.
export function redact(text, values) {
  let out = String(text ?? "");
  for (const v of Object.values(values || {})) {
    if (!v) continue;
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

// Manifest file in a private temp dir; returns { file, dir, cleanup }.
export function writePrivateManifest(manifest) {
  const dir = mkdtempSync(join(tmpdir(), "bascule-secret-"));
  chmodSync(dir, 0o700);
  const file = join(dir, "secret.json");
  writeFileSync(file, JSON.stringify(manifest), { mode: 0o600 });
  return { file, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function makeDocsSyncSecret(h) {
  const { log, die, section, run, jobDefaults } = h;

  function cmdFill() {
    section("S3.0 docs-sync Secret — rewrite from GitHub (environment radar-bascule)");
    let values;
    try { values = secretValuesFromEnv(process.env); } catch (e) { die(e.message); }
    const jd = jobDefaults();
    const ns = jd.NAMESPACE;
    const name = jd.DOCS_SYNC_READ_SECRET;
    if (!K8S_NAME_RE.test(name)) die("DOCS_SYNC_READ_SECRET is not a valid Secret name");
    // Metadata of the PRE-CREATED Secret (kubectl prints the labels/annotations only).
    const lab = run("kubectl", ["-n", ns, "get", "secret", name, "-o", "jsonpath={.metadata.labels}"], { capture: true, allowFail: true });
    if (lab.status !== 0) {
      die(`docs-secret-fill — Secret ${ns}/${name} not readable: it must be PRE-CREATED (k8s) with get/update granted by name to the bascule SA.`);
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
          die(`docs-secret-fill — kubectl replace${pass.length ? " --dry-run=server" : ""} failed on ${ns}/${name}: ${first}`);
        }
      }
    } finally {
      tmp.cleanup();
    }
    log(`docs-secret-fill OK — Secret ${ns}/${name} rewritten (keys ${Object.keys(values).join(", ")}; values never printed).`);
  }

  return { commands: { "docs-secret-fill": cmdFill } };
}
