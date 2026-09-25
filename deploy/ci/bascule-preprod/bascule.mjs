#!/usr/bin/env node
// =============================================================================
// bascule.mjs — BASCULE PROD → PRÉPROD (« iso-prod »), CLI natif, 0 Python.
//
// Orchestre, en Node pur (aucune IA au runtime), la séquence S0→S7 : dump prod
// (déclencheur) → restore préprod → migrations → copie docs → recon → flip
// serving → refresh différentiel → smoke. Rejouable par la CI immo / l'owner
// SANS IA (OPS-3), avec des gardes fail-closed en Node.
//
// DATA-PLANE 100% CLUSTER-SIDE, RUNNER KUBECTL-ONLY (contrat owner + co-val
// i-infra, NON négociable) : AUCUNE donnée PII, AUCUNE cred S3, AUCUN listing/clé
// ne transite ni n'est lu par le runner GitHub (OVH n'a pas de scope S3 list-only
// → toute cred S3 runner pourrait GET le dump PII → 0 cred S3 runner). Le runner
// ne fait QUE du kubectl (2 kubeconfigs : préprod par défaut + PROD pour le seul
// trigger dump) + `curl` /health (smoke, ni S3 ni PII) :
//   - kubectl : patch cronjob (suspend), dispatch/OBSERVE Jobs (.status SEUL,
//     JAMAIS `kubectl logs`), scale (quiesce), flip (set-env).
// TOUT l'accès object-store ET DB (fetch/upload/copie/LIST/HEAD/dryrun) vit dans
// des Jobs PRÉPROD verdict-only (creds via secretKeyRef in-cluster, jamais d'URI
// mot-de-passe ; ils ne renvoient qu'un exit code). Le runner reste PII-free, ses
// LOGS compris. dump prod = CronJob owner (`radar-db-backup-prod`, HORS de ce
// patch) ; restore/rollback/docs-sync + checks freshness/recon/runs = patrons ici.
//
//   Sous-commandes :
//     preflight    S0  — binaires runner (kubectl/node/curl) + params + EXPECTED_DATABASE.
//     dump         S1  — DÉCLENCHEUR T1 : patch CronJob prod suspend=false (via
//                        kubeconfig PROD dédié DUMP_KUBECONFIG — les 2 SEULS
//                        kubectl prod), puis Job freshness (poll interne, verdict),
//                        re-suspend. 0 pg_dump/0 S3 runner.
//     restore      S2  — GARDES (G2 quiesce, G1 Job rollback) puis Job restore
//                        (fetch self-select + pg_restore). 0 pg_restore/0 S3 runner.
//     migrate      S2c — Job in-cluster `node dist/db/migrate.js` (patron 36).
//     copy-docs    S3  — Job in-cluster aws-cli (pré-check GET + s3 sync additif).
//     recon        S3b — Job list-objects-v2 diff Key+Size (verdict-only, dest ⊇ src).
//     precheck-runs S3c — Job aws s3api list runs/ (verdict-only, gate MEDIUM3).
//     flip         S5  — kubectl set env deploy/radar-api GEO_DOCUMENTS_REPOINT-
//     refresh      S6  — Job in-cluster worker-live.js en mode delta (PAS --all).
//     smoke        S7  — curl préprod/health (db.ok + objectStore.ok).
//
//   GARDES fail-closed (clé OPS-3) :
//     G1  restore refuse de partir sans Job rollback préprod réussi (pg_dump
//         préprod → bucket, DURABLE). Fail-closed : pas de restore sans rollback.
//     G2  restore refuse si les consommateurs préprod ne sont pas quiesce
//         (Deployments scale 0 + CronJobs suspend + 0 Job batch NON-bascule actif).
//     G3  CONFIRM explicite (input workflow_dispatch, ex. iso-prod-<date>) —
//         sans quoi aucune étape mutante ne s'exécute.
//     G4  flip ne s'exécute QUE si recon (S3b, Job verdict) est vert (sentinel + re-run).
//     +   EXPECTED_DATABASE : contrôle POSITIF hors runner — clé du dump frais
//         (Jobs freshness/restore) ⊇ EXPECTED_DATABASE, et header du custom-archive
//         (`;   dbname:`) == EXPECTED_DATABASE vérifié DANS le Job restore.
//
//   AUCUNE exécution réelle n'est faite par ce fichier au moment du build ;
//   il est piloté par .github/workflows/bascule-preprod.yml (workflow_dispatch).
// =============================================================================
import { spawnSync } from "node:child_process";
import console from "node:console";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ── petits utilitaires de sortie (jamais de secret imprimé) ─────────────────
const log = (msg) => console.log(`[bascule] ${msg}`);
const warn = (msg) => console.log(`::warning title=bascule::${msg}`);
const die = (msg) => {
  console.log(`::error title=bascule failed::${msg}`);
  process.exit(1);
};
const section = (title) => log(`──────── ${title} ────────`);

// ── accès env : req = obligatoire (fail-closed), opt = défaut ───────────────
const req = (name) => {
  const v = process.env[name];
  if (v === undefined || v === "") die(`variable d'environnement requise absente : ${name}`);
  return v;
};
const opt = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

// ── exécution d'un outil natif. On NE journalise JAMAIS l'env (secrets). ─────
// `env` : surcouche fusionnée au process.env pour l'enfant uniquement.
// `capture` : true → renvoie stdout/stderr (utilisé pour recon / jsonpath).
function run(cmd, args, { env = {}, capture = false, allowFail = false, input } = {}) {
  const printable = `${cmd} ${args.map((a) => (a.startsWith("s3://") || /^[A-Za-z0-9._/=:@-]+$/.test(a) ? a : `'${a}'`)).join(" ")}`;
  log(`$ ${printable}`);
  const res = spawnSync(cmd, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    input,
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
    maxBuffer: 1024 * 1024 * 64,
  });
  if (res.error) {
    if (allowFail) return { status: 1, stdout: "", stderr: String(res.error) };
    die(`échec de lancement de ${cmd} : ${res.error.message}`);
  }
  if (!allowFail && res.status !== 0) {
    if (capture && res.stderr) console.log(res.stderr);
    die(`${cmd} a retourné un code non nul (${res.status})`);
  }
  return { status: res.status ?? 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// ── GARDE G3 : CONFIRM explicite = GO owner matérialisé ─────────────────────
// Motif imposé : iso-prod-AAAA-MM-JJ. Si CONFIRM_EXPECTED est fourni (le
// workflow le calcule = iso-prod-<aujourd'hui>), on exige l'égalité exacte pour
// interdire tout rejeu d'un CONFIRM périmé.
function assertConfirm() {
  const confirm = opt("CONFIRM", "");
  if (!/^iso-prod-\d{4}-\d{2}-\d{2}$/.test(confirm)) {
    die(
      "GARDE G3 — CONFIRM absent ou mal formé. Attendu un input workflow_dispatch " +
        "de la forme 'iso-prod-AAAA-MM-JJ' (GO owner). Rien n'a été exécuté.",
    );
  }
  const expected = opt("CONFIRM_EXPECTED", "");
  if (expected && confirm !== expected) {
    die(
      `GARDE G3 — CONFIRM='${confirm}' ne correspond pas à la valeur attendue du jour ` +
        `('${expected}'). Anti-rejeu : rien n'a été exécuté.`,
    );
  }
  log(`GARDE G3 OK — CONFIRM='${confirm}'`);
}

// ── Normalisation d'endpoint object-store — fonction PURE ───────────────────
// aws-cli ET aws-sdk EXIGENT un schéma sur --endpoint-url : un host nu comme
// `s3.bhs.io.cloud.ovh.net` (valeur de BHS) fait ERRORER aws-cli → le
// `length(Contents)` rend `None` (faux « vide ») et `aws s3 …` rc≠0. On préfixe
// `https://` si le schéma est absent (idempotent sur une URL déjà schémée). C'est
// le ROOT CAUSE UNIQUE des faux-négatifs de check en DRY (PAS le path-style : BHS
// accepte virtual ET path).
export function withScheme(endpoint) {
  const e = String(endpoint || "").trim();
  if (!e) return e;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? e : `https://${e}`;
}

// ── Défauts partagés des Jobs data-plane (images + secrets in-cluster) ──────
// Le runner ne touche JAMAIS à ces creds NI à S3 : tout l'accès object-store
// (fetch/upload/check/recon/runs) vit dans des Jobs préprod, creds résolus au
// runtime via secretKeyRef. Ici on ne rend que des NOMS de secret + des
// images/params NON secrets. Overridables par env pour la QA / autres clusters.
function jobDefaults() {
  return {
    NAMESPACE: opt("PREPROD_NAMESPACE", "radar-immobilier-preprod"),
    // Images natives déjà validées (0 image Python). postgis = pg_dump/pg_restore 16 ;
    // amazon/aws-cli (déjà pinné in-repo, cf. object-storage-inventory) = LIST/HEAD/cp/sync
    // scriptable (0 s5cmd runner ni Job — un seul outil S3 in-cluster, image prouvée).
    DUMP_IMAGE: opt("BASCULE_PG_IMAGE", "postgis/postgis:16-3.4"),
    AWSCLI_IMAGE: opt(
      "BASCULE_AWSCLI_IMAGE",
      "amazon/aws-cli:2.34.53@sha256:cf53765c0de54ad3a8ea21818f1c4c845a8cf7ca87831c078a00fef244031493",
    ),
    // Secret DB préprod (restore/rollback/migrate) — clés POSTGRES_USER/PASSWORD/DB.
    // user préprod `radar` = superuser → `pg_restore --clean --if-exists` OK.
    DB_SECRET: opt("DB_SECRET", "radar-db-credentials"),
    // Secret PRA = S3 SEULEMENT (RW bucket backups) — clés S3_ACCESS_KEY/S3_SECRET_KEY.
    // PAS de POSTGRES_* (mesure k8s). Owner/immo-délivré, HORS de ce patch.
    PRA_SECRET: opt("PRA_SECRET", "radar-pra-admin"),
    // Secrets PERSISTANTS des Jobs de CHECK (verdict-only, LIST/HEAD/dryrun) —
    // distincts de la cred docs-sync ÉPHÉMÈRE (sinon CreateContainerConfigError
    // aux pas de check). Mêmes clés S3_ACCESS_KEY/S3_SECRET_KEY.
    //  - freshness (S1)          : RO-reader du bucket backups (minté par k8s) ;
    //  - recon + runs/ (S3b/S3c) : LIST prod+préprod docs (cred applicative).
    FRESHNESS_CHECK_SECRET: opt("FRESHNESS_CHECK_SECRET", "radar-backups-reader-preprod"),
    CHECK_DOCS_SECRET: opt("CHECK_DOCS_SECRET", "radar-docs-reader-preprod"),
    // Secret docs PROD-READ ÉPHÉMÈRE (Option A, co-val i-infra) : identité
    // PROPRIÉTAIRE des objets docs prod (immo-docs-prod), montée en préprod dans un
    // secret dédié `radar-docs-src-preprod` — clés S3_ACCESS_KEY/S3_SECRET_KEY.
    // CRÉÉ par k8s au GO (le runner ne l'a jamais) et GC par ownerReference du Job
    // docs-sync (ttl auto-clean) → la CI ne crée/lit/supprime AUCUN secret.
    // SPANNING read prod + rw préprod : docs-sync (copie), recon, advisory runs/ prod.
    DOCS_SYNC_READ_SECRET: opt("DOCS_SYNC_READ_SECRET", "radar-docs-src-preprod"),
    // Grantee canonical id radar-docs PRÉPROD (GrantFullControl sur les objets
    // copiés → lisibles par l'API préprod, sinon 403 propagé). Vide → pas de grant.
    DOCS_SYNC_GRANTEE: opt("DOCS_SYNC_GRANTEE", ""),
    // Hôte service Postgres préprod (libpq côté Job, jamais côté runner).
    PGHOST: opt("PREPROD_PGHOST_SERVICE", "radar-postgres"),
    // Endpoint object-store (BHS) + région — rendus dans les Jobs (non secrets).
    // withScheme() garantit https:// (BHS est un host nu → aws-cli/aws-sdk errorent
    // sans schéma). S'applique à TOUS les Jobs (checks/docs-sync/restore/rollback).
    S3_ENDPOINT: withScheme(req("BHS")),
    S3_REGION: opt("S3_REGION", ""),
    TTL_SECONDS: opt("JOB_TTL_SECONDS", "3600"),
  };
}

// ── répertoire de travail (dumps, sentinels) — persiste dans un run de job ──
function workdir() {
  const dir = opt("BASCULE_WORKDIR", join(process.cwd(), ".bascule-work"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// =============================================================================
// classifyJobStatus — fonction PURE (testable) : interprète le `.status` d'un
// Job k8s (kubectl get job -o json) en verdict pass/fail/en-cours. C'EST la
// SEULE information que le runner lit d'un Job : JAMAIS `kubectl logs` ni le
// stdout du pod (qui portent clés/tables/listings/contenu). Runner PII-free,
// logs runner compris. backoffLimit 0 → 1 pod : succeeded>=1 = OK, failed>=1 = KO.
// =============================================================================
export function classifyJobStatus(status) {
  const s = status || {};
  const succeeded = Number(s.succeeded ?? 0);
  const failed = Number(s.failed ?? 0);
  const active = Number(s.active ?? 0);
  if (Number.isFinite(succeeded) && succeeded >= 1) return { done: true, ok: true, state: "succeeded" };
  if (Number.isFinite(failed) && failed >= 1) return { done: true, ok: false, state: "failed" };
  return { done: false, ok: false, state: active > 0 ? "active" : "pending" };
}

// =============================================================================
// recon DIFF (dest ⊇ src) — fonctions PURES (miroir du awk in-pod du Job recon
// s3-check-job, mode=recon). La recon ne HEAD/GET plus (403 ACL prod) : elle
// LISTE src et dst (`s3api list-objects-v2 --query Contents[].[Key,Size]`) et
// compare Key+Size. Exportées pour verrouiller l'algo au self-test (l'exécution
// réelle reste le awk in-pod, aws-cli, verdict par exit code).
// =============================================================================

// Pure : parse une sortie `--output text` de `Contents[].[Key,Size]` (lignes
// TAB-séparées « <key>\t<size> ») → Map key→size. Split sur TAB (les clés S3
// peuvent contenir des espaces ; aws --output text sépare les colonnes par TAB).
// On ne retient QUE la Size (colonne 1 après la clé) : un éventuel ETag (col 2+)
// est IGNORÉ — les docs sont content-addressed par sha (key = raw/…/<sha>.pdf ⇒
// même key = même contenu ; Size confirme ; l'ETag n'ajoute que la fragilité
// multipart : CopyObject server-side peut re-chunker → ETag ≠ source, faux PENDING).
// Lignes vides ignorées.
export function parseListingMeta(text) {
  const m = new Map();
  for (const raw of (text || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const cols = line.split("\t");
    if (cols[0] === "" || cols[0] === undefined) continue;
    m.set(cols[0], cols[1] ?? ""); // Size SEULEMENT (ETag ignoré)
  }
  return m;
}

// Pure : clés de src ABSENTES de dst OU de Size différente (dest ⊉ src). Vide ⇒
// dest ⊇ src (recon OK, 0 HEAD/GET). Miroir du awk -F'\t' in-pod (Key+Size).
export function reconMissing(srcText, dstText) {
  const dst = parseListingMeta(dstText);
  const missing = [];
  for (const [key, size] of parseListingMeta(srcText)) {
    if (!dst.has(key) || dst.get(key) !== size) missing.push(key);
  }
  return missing;
}

// =============================================================================
// dispatchS3Check — dispatche un Job de CHECK S3 verdict-only (s3-check-job).
//
// Le runner NE TOUCHE PLUS S3 (0 cred S3 runner : OVH n'a pas de scope list-only,
// donc toute cred S3 runner pourrait GET le dump PII). Les 3 vérifs S3
// (freshness S1, recon S3b, runs/ S3c/MEDIUM3) sont des Jobs PRÉPROD qui font le
// LIST/HEAD/--dryrun DANS le pod (cred in-cluster) et ne renvoient qu'un exit code.
//
// `secret` = NOM du secret PERSISTANT à monter, FIXÉ PAR PAS par l'appelant
// (pas de cred éphémère docs-sync ici, sinon CreateContainerConfigError aux pas
// de check). Défauts (mêmes clés S3_ACCESS_KEY/S3_SECRET_KEY) :
//   - freshness (S1)          → radar-backups-reader-preprod (RO-reader backups) ;
//   - recon + runs/ (S3b/S3c) → radar-docs-reader-preprod (RO-reader, LIST prod+préprod docs).
// failClosed=false → renvoie { ok } au lieu de die (S1 doit re-suspendre AVANT
// de trancher). Le runner ne lit que .status (via runJobFromTemplate).
// =============================================================================
function dispatchS3Check({ mode, jobName, secret, accessKeyName = "S3_ACCESS_KEY", secretKeyName = "S3_SECRET_KEY", params = {}, timeoutSec, failClosed = true }) {
  const jd = jobDefaults();
  return runJobFromTemplate({
    tmpl: "s3-check-job.tmpl.yaml",
    jobName,
    failClosed,
    timeoutSec,
    vars: {
      JOB_NAME: jobName,
      NAMESPACE: jd.NAMESPACE,
      AWSCLI_IMAGE: jd.AWSCLI_IMAGE,
      CHECK_SECRET: secret,
      CHECK_ACCESS_KEY: accessKeyName,
      CHECK_SECRET_KEY: secretKeyName,
      S3_ENDPOINT: jd.S3_ENDPOINT,
      S3_REGION: jd.S3_REGION,
      CHECK_MODE: mode,
      CHECK_BUCKET: params.bucket || "",
      CHECK_PREFIX: params.prefix || "",
      CHECK_SRC_BUCKET: params.srcBucket || "",
      CHECK_DST_BUCKET: params.dstBucket || "",
      CHECK_T1_EPOCH: String(params.t1Epoch ?? "0"),
      CHECK_EXPECTED_DATABASE: params.expectedDb || "",
      CHECK_KEY_SUFFIX: params.keySuffix || ".dump",
      CHECK_TIMEOUT_SEC: String(params.checkTimeoutSec ?? "0"),
      CHECK_POLL_SEC: String(params.pollSec ?? "15"),
      TTL_SECONDS: jd.TTL_SECONDS,
    },
  });
}

// =============================================================================
// precheck-runs — garde « mémoire de collecte » = Job PRÉPROD verdict-only.
//
// MEDIUM 3 : le refresh S6 (worker-live delta) ne fait un DELTA — pas un rescrape
// complet — que si le préfixe `runs/` (état object-store des URLs collectées) est
// présent dans le bucket qu'il LIT. Le runner ne touchant plus S3, cette garde est
// un Job PRÉPROD (aws s3api list, cred docs in-cluster) qui EXIT 1 si `runs/` est
// vide/absent (ou accès refusé), EXIT 0 sinon. Le runner ne lit que .status.
//
// Cible défaut = PREPROD_DOCS (gate, bucket réellement lu par S6). --prod (ou
// PRECHECK_TARGET=prod) → PROD_DOCS : advisory (prédiction précoce) rendu
// non-bloquant par `continue-on-error` côté workflow (le Job, lui, tranche pareil).
// =============================================================================
function cmdPrecheckRuns() {
  const wantsProd = process.argv.includes("--prod") || opt("PRECHECK_TARGET", "") === "prod";
  const bucket = wantsProd ? req("PROD_DOCS") : req("PREPROD_DOCS");
  const label = wantsProd ? "PROD_DOCS (advisory)" : "PREPROD_DOCS (gate)";
  section(`pré-check runs/ (mémoire de collecte) — Job in-cluster, cible ${label}`);
  dispatchS3Check({
    mode: "runs",
    jobName: wantsProd ? "radar-bascule-runs-prod" : "radar-bascule-runs-preprod",
    // Secret PERSISTANT radar-docs-reader-preprod (RO-reader, LIST prod+préprod docs) — PAS la
    // cred docs-sync éphémère. Overridable via CHECK_DOCS_SECRET.
    secret: jobDefaults().CHECK_DOCS_SECRET,
    params: { bucket, prefix: opt("RUNS_PREFIX", "runs/") },
    timeoutSec: Number(opt("CHECK_TIMEOUT", "180")),
  });
  log(`pré-check runs/ OK — 'runs/' peuplé dans ${label} (verdict Job, 0 listing runner).`);
}

// =============================================================================
// S0 — preflight : binaires + secrets + EXPECTED_DATABASE
// =============================================================================
function cmdPreflight() {
  section("S0 preflight");
  // Binaires RUNNER = kubectl-only (data-plane + object-store 100% cluster-side).
  // Plus AUCUN pg_dump/pg_restore NI s5cmd/aws sur le runner. `node` exécute ce
  // CLI ; `curl` sert au seul smoke S7 (GET /health, ni S3 ni PII) ; `bash` pour
  // command -v / sleep. AUCUN outil S3 côté runner.
  const bins = ["node", "kubectl", "curl"];
  const missing = bins.filter((b) => run("bash", ["-lc", `command -v ${b}`], { capture: true, allowFail: true }).status !== 0);
  if (missing.length) die(`binaires manquants sur le runner : ${missing.join(", ")}`);
  log(`binaires présents (runner kubectl-only + curl smoke) : ${bins.join(", ")}`);

  // Params indispensables côté runner (présence seule — jamais la valeur). AUCUNE
  // cred S3 ni DB sur le runner : 0 AWS_*, 0 PROD_PG*/PREPROD_PG*. Ne restent que
  // des paramètres NON secrets rendus dans les Jobs (endpoint/buckets/DB attendue).
  const required = [
    "EXPECTED_DATABASE", "BHS",
    "PROD_DOCS", "PREPROD_DOCS", "DUMP_BUCKET",
  ];
  const absent = required.filter((k) => !process.env[k]);
  if (absent.length) die(`paramètres CI absents : ${absent.join(", ")}`);
  log(`paramètres présents : ${required.length} clés (0 cred S3/DB runner)`);

  // Contrôle POSITIF EXPECTED_DATABASE — hors runner (le runner ne parle à AUCUNE
  // DB ni S3). Assuré fail-closed in-cluster : (a) Job freshness/restore — la clé
  // du dump frais ⊇ EXPECTED_DATABASE ; (b) Job restore — header du custom-archive
  // (`; dbname:`) == EXPECTED_DATABASE. Le CronJob dump owner dumpe la DB nommée
  // EXPECTED_DATABASE (pg_dump --format=custom --no-owner --no-privileges).
  log(`EXPECTED_DATABASE='${process.env.EXPECTED_DATABASE}' — contrôle positif assuré in-cluster (Jobs freshness/restore).`);
  log("S0 preflight OK");
}

// =============================================================================
// S1 — DÉCLENCHEUR DU DUMP (T1). 0 pg_dump runner, 0 S3 runner.
//
// Le runner ne dumpe RIEN et ne touche PAS S3 : il DÉCLENCHE le CronJob prod
// owner (`radar-db-backup-prod`) en le dé-suspendant (kubeconfig PROD dédié ;
// patch name-scopé — VAP owner suspend-only), puis DISPATCHE un Job PRÉPROD de
// FRESHNESS (cred backups in-cluster) qui POLL EN INTERNE la présence d'un dump
// FRAIS (LastModified epoch > T1, clé ⊇ EXPECTED_DATABASE, suffixe .dump,
// taille>0) et renvoie exit 0/non-0. Le runner ne lit que `.status` du Job
// (JAMAIS ses logs). Il RE-SUSPEND TOUJOURS le CronJob (best-effort, kubeconfig
// PROD), y compris si la freshness a échoué, PUIS tranche fail-closed.
// Contrôle POSITIF EXPECTED_DATABASE : (a) clé ⊇ EXPECTED_DATABASE (freshness
// Job), (b) header du custom-archive (Job restore). Aucune donnée ne remonte.
// =============================================================================
function cmdDump() {
  section("S1 dump prod — DÉCLENCHEUR T1 (patch CronJob + Job freshness, 0 pg_dump/0 S3 runner)");
  assertConfirm(); // le déclencheur ouvre la séquence armée (G3)
  const expected = req("EXPECTED_DATABASE");
  const bucket = req("DUMP_BUCKET"); // radar-immobilier-backups-preprod
  const prefix = opt("DUMP_PREFIX", "postgres/prod/sets").replace(/^\/+|\/+$/g, "");
  const cjNs = opt("DUMP_CRONJOB_NAMESPACE", "radar-immobilier");
  const cj = opt("DUMP_CRONJOB", "radar-db-backup-prod");
  const assertDbInKey = opt("DUMP_KEY_ASSERT_DB", "1") !== "0";
  const keyMustContain = assertDbInKey ? expected : "";
  const keySuffix = opt("DUMP_KEY_SUFFIX", ".dump");
  const skewSec = Number(opt("FRESHNESS_SKEW_SEC", "120"));
  const checkTimeoutSec = Number(opt("DUMP_TIMEOUT", "1800"));
  const pollSec = Number(opt("DUMP_POLL_INTERVAL", "20"));
  const dir = workdir();

  // DUAL-KUBECONFIG — le déclencheur cible le cluster PROD (le CronJob dumpe la
  // DB prod IN-CLUSTER). Les 2 SEULS kubectl prod du CLI (suspend=false ET
  // re-suspend=true) passent par un kubeconfig PROD DÉDIÉ (DUMP_KUBECONFIG),
  // name-scopé au patch de CE CronJob + VAP suspend-only. TOUS les autres kubectl
  // (quiesce, dispatch Jobs, flip, refresh) restent sur le kubeconfig PRÉPROD par
  // défaut. Fail-closed : sans DUMP_KUBECONFIG, AUCUN patch tenté (le kubeconfig
  // préprod ferait 403 sur la prod ; on ne veut pas de trigger sans token prod).
  const dumpKubeconfig = opt("DUMP_KUBECONFIG", "");
  if (!dumpKubeconfig || !existsSync(dumpKubeconfig)) {
    die(
      "S1 — DUMP_KUBECONFIG (kubeconfig PROD dédié au patch du CronJob dump) absent ou introuvable : " +
        `le déclencheur patche '${cj}' dans le cluster PROD (ns ${cjNs}) — le kubeconfig préprod par défaut ferait 403. ` +
        "Fail-closed : aucun patch tenté.",
    );
  }
  const kprod = ["--kubeconfig", dumpKubeconfig]; // préfixe kubectl PROD (2 appels seulement)

  // T1 = instant de déclenchement (epoch secondes), moins une marge d'horloge
  // (skew runner/S3) pour ne pas rejeter un dump légitimement frais. Persisté
  // (T1.txt) pour que le Job restore re-sélectionne le même dump frais.
  const t1Ms = Date.now();
  const t1Epoch = Math.floor((t1Ms - skewSec * 1000) / 1000);
  writeFileSync(join(dir, "T1.txt"), `${new Date(t1Ms).toISOString()}\n`, { mode: 0o600 });
  writeFileSync(join(dir, "T1_EPOCH.txt"), `${t1Epoch}\n`, { mode: 0o600 });
  log(`T1=${new Date(t1Ms).toISOString()} (fraîcheur exigée : LastModified epoch > ${t1Epoch}, skew ${skewSec}s)`);

  // Déclencheur : dé-suspendre le CronJob prod (kubeconfig PROD ; name-scopé ;
  // VAP owner = suspend-only). --kubeconfig sur CET appel prod uniquement.
  section("S1.a déclencheur — kubectl (PROD) patch cronjob suspend=false");
  run("kubectl", [...kprod, "-n", cjNs, "patch", "cronjob", cj, "--type=merge", "-p", '{"spec":{"suspend":false}}']);
  log(`CronJob ${cjNs}/${cj} dé-suspendu (cluster PROD) — le pg_dump prod (owner) → s3://${bucket} démarre hors runner.`);

  // Freshness = Job PRÉPROD verdict-only (poll interne au pod). Secret PERSISTANT
  // RO-reader du bucket backups (radar-backups-reader-preprod) — PAS la cred
  // docs-sync éphémère. Overridable via FRESHNESS_CHECK_SECRET.
  // failClosed:false → on récupère { ok } pour RE-SUSPENDRE avant de trancher.
  section("S1.b freshness — Job in-cluster (aws s3api list, verdict-only, 0 S3 runner)");
  const verdict = dispatchS3Check({
    mode: "freshness",
    jobName: "radar-bascule-freshness",
    secret: jobDefaults().FRESHNESS_CHECK_SECRET,
    failClosed: false,
    params: {
      bucket, prefix, t1Epoch, expectedDb: keyMustContain, keySuffix,
      checkTimeoutSec, pollSec,
    },
    // le runner attend un peu plus que le poll interne du pod.
    timeoutSec: checkTimeoutSec + Number(opt("CHECK_POLL_BUFFER", "180")),
  });

  // Re-suspend TOUJOURS (best-effort, même si freshness KO ; kubeconfig PROD).
  const resus = run("kubectl", [...kprod, "-n", cjNs, "patch", "cronjob", cj, "--type=merge", "-p", '{"spec":{"suspend":true}}'], { allowFail: true });
  if ((resus.status ?? 0) !== 0) warn(`S1 — re-suspend du CronJob ${cjNs}/${cj} a ÉCHOUÉ : à re-suspendre à la main (kubectl patch ... suspend=true).`);
  else log(`CronJob ${cjNs}/${cj} re-suspendu.`);

  if (!verdict.ok) {
    die(
      `S1 — Job freshness '${verdict.jobName || "radar-bascule-freshness"}' ${verdict.state || "KO"} : aucun dump FRAIS ` +
        `(exigé : LastModified > T1${keyMustContain ? `, clé ⊇ '${keyMustContain}'` : ""}, suffixe '${keySuffix}', taille>0) ` +
        `sous s3://${bucket}/${prefix || ""} dans le délai. Fail-closed — inspecter le Job in-cluster (0 logs runner).`,
    );
  }
  log("S1 dump OK — Job freshness a confirmé un dump frais (verdict .status). 0 pg_dump runner, 0 S3/contenu runner.");
}

// =============================================================================
// GARDE G2 — quiesce : consommateurs préprod scale 0 / suspend (kubectl RO)
// =============================================================================
function assertQuiesced() {
  const ns = opt("PREPROD_NAMESPACE", "radar-immobilier-preprod");
  const deployments = opt("QUIESCE_DEPLOYMENTS", "radar-api,radar-immo-mcp").split(",").map((s) => s.trim()).filter(Boolean);
  const cronjobs = presentCronjobs(ns, opt("QUIESCE_CRONJOBS", "radar-refresh-pv,radar-consistency-snapshot,radar-populate-geo-daily").split(",").map((s) => s.trim()).filter(Boolean));
  const problems = [];
  for (const d of deployments) {
    const spec = run("kubectl", ["-n", ns, "get", "deploy", d, "-o", "jsonpath={.spec.replicas}"], { capture: true, allowFail: true });
    if (spec.status !== 0) { problems.push(`deploy/${d} illisible (${spec.stderr.trim() || "absent ?"})`); continue; }
    const cur = run("kubectl", ["-n", ns, "get", "deploy", d, "-o", "jsonpath={.status.replicas}"], { capture: true, allowFail: true });
    const specR = (spec.stdout || "0").trim() || "0";
    const curR = (cur.stdout || "0").trim() || "0";
    if (specR !== "0" || curR !== "0") problems.push(`deploy/${d} non quiesce (spec.replicas=${specR}, status.replicas=${curR})`);
  }
  for (const c of cronjobs) {
    const sus = run("kubectl", ["-n", ns, "get", "cronjob", c, "-o", "jsonpath={.spec.suspend}"], { capture: true, allowFail: true });
    if (sus.status !== 0) { problems.push(`cronjob/${c} illisible (${sus.stderr.trim() || "absent ?"})`); continue; }
    if ((sus.stdout || "").trim() !== "true") problems.push(`cronjob/${c} non suspendu (spec.suspend=${(sus.stdout || "").trim() || "<vide>"})`);
  }
  // Renfort G2 (certif i-infra) — 0 Job batch ACTIF. Les Jobs one-off (radar-scrape,
  // radar-graph-projection[-only], radar-graphify*, radar-export-graph-nodes,
  // radar-populate-geo, radar-run-geo-mapper, radar-consistency-snapshot-once,
  // radar-db-migrate, …) tiennent une connexion à radar-postgres SEULEMENT quand
  // ils tournent → ils échappent à la quiesce-list (deploys/cronjobs). Un restore
  // destructif pendant qu'un Job écrit corromprait l'état. Fail-closed : refuse si
  // un Job a status.active>0 (pods running/pending = non terminé). Échappatoire
  // documentée OFF par défaut (SKIP_ACTIVE_JOBS_CHECK=1).
  if (opt("SKIP_ACTIVE_JOBS_CHECK", "0") === "1") {
    warn("GARDE G2 — contrôle 'Job batch actif' DÉSACTIVÉ (SKIP_ACTIVE_JOBS_CHECK=1).");
  } else {
    const jr = run("kubectl", ["-n", ns, "get", "jobs", "-o", "json"], { capture: true, allowFail: true });
    if (jr.status !== 0) {
      problems.push(`liste des Jobs préprod illisible (${(jr.stderr || "").trim() || "kubectl get jobs a échoué"})`);
    } else {
      let items = [];
      try { items = JSON.parse(jr.stdout || "{}").items || []; } catch { problems.push("sortie 'kubectl get jobs -o json' illisible"); }
      const active = [];
      let skippedBascule = 0;
      for (const j of items) {
        const name = j?.metadata?.name ?? "<sans-nom>";
        // EXCLUSION G2 — les Jobs que CETTE bascule dispatche (restore, rollback,
        // docs-sync, migrate, refresh) portent le label `sentropic.io/bascule`.
        // Ils sont ATTENDUS actifs pendant la séquence : ils ne doivent PAS se
        // compter eux-mêmes comme « Job actif » bloquant (sinon G1-rollback ⇒ G2
        // se bloquerait lui-même). Le quiesce ordonné AVANT tout dispatch reste la
        // 1re barrière ; cette exclusion couvre le rejeu (TTL) et l'ordre interne.
        if (j?.metadata?.labels?.["sentropic.io/bascule"]) { skippedBascule += 1; continue; }
        const st = j?.status ?? {};
        const nActive = Number(st.active ?? 0);
        if (Number.isFinite(nActive) && nActive > 0) active.push(`${name} (active=${nActive})`);
      }
      if (skippedBascule) log(`GARDE G2 — ${skippedBascule} Job(s) labelisé(s) 'bascule' exclu(s) du check (attendus).`);
      if (active.length) {
        problems.push(
          `Job(s) batch ACTIF(s) en préprod (connexion radar-postgres possible) : ${active.join(", ")} ` +
            "— attendre leur fin (ou les supprimer) avant le restore destructif.",
        );
      } else {
        log(`GARDE G2 — 0 Job batch actif en préprod (${items.length} Job(s) inspecté(s)).`);
      }
    }
  }
  if (problems.length) {
    die(
      "GARDE G2 — consommateurs préprod NON quiesce (restore refusé) :\n  - " +
        problems.join("\n  - ") +
        "\n  → lancer 'quiesce' (ou scale 0 + suspend à la main), puis relancer.",
    );
  }
  log(`GARDE G2 OK — quiesce vérifié (deploys=${deployments.join(",")} ; crons=${cronjobs.join(",")})`);
}

// Liste des consommateurs (partagée quiesce / un-quiesce / G2).
function quiesceTargets() {
  return {
    ns: opt("PREPROD_NAMESPACE", "radar-immobilier-preprod"),
    deployments: opt("QUIESCE_DEPLOYMENTS", "radar-api,radar-immo-mcp").split(",").map((s) => s.trim()).filter(Boolean),
    cronjobs: opt("QUIESCE_CRONJOBS", "radar-refresh-pv,radar-consistency-snapshot,radar-populate-geo-daily").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

// Filtre une liste de CronJobs pour ne garder que ceux réellement présents dans
// le namespace. Un CronJob absent = rien à quiescer : la préprod n'a pas toujours
// le même jeu de crons que la prod (ex. radar-populate-geo-daily non déployé en
// préprod). On tolère donc l'absence (fail-open sur un objet inexistant), au lieu
// de faire échouer quiesce/G2 sur un NotFound. La quiesce reste fail-CLOSED sur
// tout cron PRÉSENT non suspendu — on n'élargit pas la surface, on ignore le vide.
function presentCronjobs(ns, cronjobs) {
  const present = [];
  for (const c of cronjobs) {
    const r = run("kubectl", ["-n", ns, "get", "cronjob", c, "-o", "name"], { capture: true, allowFail: true });
    if (r.status === 0) present.push(c);
    else log(`quiesce — cronjob/${c} absent en préprod → ignoré (rien à quiescer).`);
  }
  return present;
}

// =============================================================================
// QUIESCE — met les consommateurs préprod au repos (scale 0 + suspend) APRÈS
// avoir ENREGISTRÉ les replicas d'origine (replay-safe) et attend le drain
// (status.replicas → 0) pour que la GARDE G2 passe juste après. Étape mutante
// → CONFIRM requis (G3). L'un-quiesce (ci-dessous) rétablit l'état d'origine.
// =============================================================================
function cmdQuiesce() {
  section("QUIESCE consommateurs préprod (scale 0 + suspend)");
  assertConfirm(); // G3
  const { ns, deployments, cronjobs } = quiesceTargets();
  const presentCrons = presentCronjobs(ns, cronjobs);
  const dir = workdir();
  const statePath = join(dir, "quiesce-state.json");
  let state;
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, "utf8"));
    log("état quiesce déjà enregistré — réutilisé (replay-safe, on ne réécrase pas l'original).");
  } else {
    state = { deployments: {}, cronjobs: {}, at: new Date().toISOString() };
    const fallback = Number(opt("QUIESCE_FALLBACK_REPLICAS", "1"));
    for (const d of deployments) {
      const r = run("kubectl", ["-n", ns, "get", "deploy", d, "-o", "jsonpath={.spec.replicas}"], { capture: true });
      let n = Number.parseInt((r.stdout || "").trim() || "0", 10);
      if (!Number.isFinite(n) || n <= 0) {
        warn(`deploy/${d} déjà à 0 (ou illisible) — un-quiesce restaurera ${fallback} replica(s).`);
        n = fallback;
      }
      state.deployments[d] = n;
    }
    for (const c of presentCrons) {
      const r = run("kubectl", ["-n", ns, "get", "cronjob", c, "-o", "jsonpath={.spec.suspend}"], { capture: true, allowFail: true });
      state.cronjobs[c] = (r.stdout || "").trim() === "true";
    }
    writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    log(`état d'origine enregistré → ${statePath}`);
  }
  // Appliquer le quiesce (idempotent).
  for (const d of deployments) run("kubectl", ["-n", ns, "scale", `deploy/${d}`, "--replicas=0"]);
  for (const c of presentCrons) run("kubectl", ["-n", ns, "patch", "cronjob", c, "-p", '{"spec":{"suspend":true}}'], { allowFail: true });
  // Attendre le drain (status.replicas → 0) pour que G2 passe immédiatement après.
  const deadline = Date.now() + Number(opt("QUIESCE_TIMEOUT", "300")) * 1000;
  for (const d of deployments) {
    for (;;) {
      const cur = run("kubectl", ["-n", ns, "get", "deploy", d, "-o", "jsonpath={.status.replicas}"], { capture: true, allowFail: true }).stdout.trim();
      if (!cur || cur === "0") { log(`deploy/${d} drainé (status.replicas=${cur || "0"})`); break; }
      if (Date.now() >= deadline) die(`quiesce — deploy/${d} non drainé (status.replicas=${cur}) dans le délai.`);
      spawnSync("bash", ["-lc", "sleep 5"], { stdio: "ignore" });
    }
  }
  log("QUIESCE OK — consommateurs préprod au repos ; état d'origine capturé pour l'un-quiesce.");
}

// =============================================================================
// UN-QUIESCE — rétablit préprod (scale-back aux replicas enregistrés + rollout
// status ; restaure le suspend d'origine des CronJobs). PAS de CONFIRM : c'est
// une action de REPRISE, jouée en `if: always()` par le workflow pour ne jamais
// laisser préprod à terre après un échec. Repli manuel : UNQUIESCE_REPLICAS
// ("radar-api=1,radar-immo-mcp=1") si aucun état enregistré (quiesce manuel).
// =============================================================================
function cmdUnquiesce() {
  section("UN-QUIESCE consommateurs préprod (restore replicas + rollout)");
  const { ns } = quiesceTargets();
  const dir = workdir();
  const statePath = join(dir, "quiesce-state.json");
  let state = null;
  if (existsSync(statePath)) {
    try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { warn("quiesce-state.json illisible."); }
  }
  if (!state) {
    const manual = opt("UNQUIESCE_REPLICAS", "");
    if (!manual) { log("aucun état quiesce enregistré et pas de UNQUIESCE_REPLICAS — rien à restaurer (no-op sûr)."); return; }
    state = { deployments: {}, cronjobs: {} };
    for (const pair of manual.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [n, v] = pair.split("=");
      if (n) state.deployments[n.trim()] = Number.parseInt((v || "1").trim(), 10);
    }
    log(`restauration depuis UNQUIESCE_REPLICAS (quiesce manuel) : ${JSON.stringify(state.deployments)}`);
  }
  const rolloutTimeout = opt("ROLLOUT_TIMEOUT", "300");
  const errs = [];
  for (const [d, n] of Object.entries(state.deployments || {})) {
    const rep = Number.isFinite(n) && n > 0 ? n : 1;
    const sc = run("kubectl", ["-n", ns, "scale", `deploy/${d}`, `--replicas=${rep}`], { allowFail: true });
    if (sc.status !== 0) { errs.push(`scale deploy/${d} → ${rep} a échoué`); continue; }
    const ro = run("kubectl", ["-n", ns, "rollout", "status", `deploy/${d}`, `--timeout=${rolloutTimeout}s`], { allowFail: true });
    if (ro.status !== 0) errs.push(`rollout deploy/${d} non prêt dans ${rolloutTimeout}s`);
    else log(`deploy/${d} restauré à ${rep} replica(s), rollout prêt.`);
  }
  for (const [c, sus] of Object.entries(state.cronjobs || {})) {
    run("kubectl", ["-n", ns, "patch", "cronjob", c, "-p", `{"spec":{"suspend":${sus ? "true" : "false"}}}`], { allowFail: true });
    log(`cronjob/${c} suspend restauré à ${!!sus}.`);
  }
  if (errs.length) {
    warn("UN-QUIESCE partiel — à vérifier côté cluster :\n  - " + errs.join("\n  - "));
    process.exit(1); // rendre l'échec de reprise visible dans le run
  }
  log("UN-QUIESCE OK — préprod restaurée à son état d'origine.");
}

// =============================================================================
// S2 — restore préprod : GARDES (G2 quiesce, G1 rollback-Job) puis Job restore.
// 0 pg_restore / 0 pg_dump / 0 get-object-contenu runner : tout le data-plane
// vit dans des Jobs PRÉPROD (creds via secretKeyRef in-cluster).
// =============================================================================
function cmdRestore() {
  section("S2 restore préprod (Jobs in-cluster — 0 pg_restore/0 S3 runner)");
  assertConfirm(); // G3
  const dir = workdir();
  const jd = jobDefaults();
  const bucket = req("DUMP_BUCKET");
  const expected = req("EXPECTED_DATABASE");
  const prefix = opt("DUMP_PREFIX", "postgres/prod/sets").replace(/^\/+|\/+$/g, "");
  const keySuffix = opt("DUMP_KEY_SUFFIX", ".dump");
  const assertDbInKey = opt("DUMP_KEY_ASSERT_DB", "1") !== "0";
  // T1 (epoch) posé par S1 : le Job restore RE-SÉLECTIONNE lui-même le dump frais
  // le plus récent (mtime > T1, clé ⊇ EXPECTED_DATABASE, .dump) — le runner ne
  // connaît AUCUNE clé S3 (0 S3 runner). Le CronJob étant re-suspendu après S1,
  // la sélection est stable.
  const t1Epoch = existsSync(join(dir, "T1_EPOCH.txt"))
    ? readFileSync(join(dir, "T1_EPOCH.txt"), "utf8").trim()
    : opt("T1_EPOCH", "0");

  // GARDE G2 — quiesce des consommateurs préprod AVANT tout dispatch. Les Jobs
  // 'bascule' (rollback/restore dispatchés ci-dessous) sont exclus du check G2.
  assertQuiesced();

  // GARDE G1 — rollback de la DB préprod AVANT le restore destructif, en Job
  // PRÉPROD (pg_dump préprod → bucket DURABLE). DB via radar-db-credentials,
  // écriture S3 via radar-pra-admin (S3-only). Fail-closed : die si Job KO.
  section("GARDE G1 — Job rollback préprod (pg_dump préprod → bucket)");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackKey = `${opt("ROLLBACK_PREFIX", "rollback").replace(/^\/+|\/+$/g, "")}/preprod-rollback-${ts}.dump`;
  runJobFromTemplate({
    tmpl: "db-rollback-job.tmpl.yaml",
    jobName: "radar-db-rollback-bascule",
    vars: {
      NAMESPACE: jd.NAMESPACE,
      DUMP_IMAGE: jd.DUMP_IMAGE,
      AWSCLI_IMAGE: jd.AWSCLI_IMAGE,
      DB_SECRET: jd.DB_SECRET,
      PRA_SECRET: jd.PRA_SECRET,
      S3_ENDPOINT: jd.S3_ENDPOINT,
      BACKUP_S3_BUCKET: bucket,
      S3_REGION: jd.S3_REGION,
      ROLLBACK_KEY: rollbackKey,
      PGHOST: jd.PGHOST,
      TTL_SECONDS: jd.TTL_SECONDS,
    },
    timeoutSec: Number(opt("ROLLBACK_TIMEOUT", "1200")),
  });
  writeFileSync(join(dir, "LATEST_PREPROD_ROLLBACK_KEY.txt"), `${rollbackKey}\n`, { mode: 0o600 });
  log(`GARDE G1 OK — rollback préprod capturé (DURABLE) : s3://${bucket}/${rollbackKey}`);

  // Restore destructif — Job PRÉPROD (fetch aws-cli self-select + pg_restore
  // --clean --if-exists --single-transaction). DB via radar-db-credentials,
  // lecture S3 via radar-pra-admin. EXPECTED_DATABASE vérifié IN-CLUSTER (clé
  // sélectionnée ⊇ EXPECTED_DATABASE ET header du custom-archive).
  section("S2.b restore — Job (fetch self-select + pg_restore --clean --single-transaction)");
  runJobFromTemplate({
    tmpl: "db-restore-job.tmpl.yaml",
    jobName: "radar-db-restore-bascule",
    vars: {
      NAMESPACE: jd.NAMESPACE,
      DUMP_IMAGE: jd.DUMP_IMAGE,
      AWSCLI_IMAGE: jd.AWSCLI_IMAGE,
      DB_SECRET: jd.DB_SECRET,
      PRA_SECRET: jd.PRA_SECRET,
      S3_ENDPOINT: jd.S3_ENDPOINT,
      BACKUP_S3_BUCKET: bucket,
      S3_REGION: jd.S3_REGION,
      DUMP_PREFIX: prefix,
      DUMP_KEY_SUFFIX: keySuffix,
      T1_EPOCH: String(t1Epoch),
      PGHOST: jd.PGHOST,
      EXPECTED_DATABASE: expected,
      ASSERT_KEY_DB: assertDbInKey ? "1" : "0",
      RESTORE_ASSERT_DB: opt("RESTORE_ASSERT_DB", "1") !== "0" ? "1" : "0",
      TTL_SECONDS: jd.TTL_SECONDS,
    },
    timeoutSec: Number(opt("RESTORE_TIMEOUT", "1800")),
  });
  log("S2 restore OK — données prod chargées en préprod (Job in-cluster ; rollback DURABLE ; EXPECTED_DATABASE vérifié in-cluster).");
}

// =============================================================================
// Rendu + apply + poll fail-closed d'un Job in-cluster (migrate / refresh)
// =============================================================================
function resolvePreprodImage(ns) {
  const override = opt("IMAGE", "");
  if (override) return override;
  // Iso-prod : on réutilise l'image radar-api EXACTE servie en préprod.
  const r = run("kubectl", ["-n", ns, "get", "deploy", "radar-api", "-o", "jsonpath={.spec.template.spec.containers[0].image}"], { capture: true });
  const img = r.stdout.trim();
  if (!img) die("image radar-api préprod introuvable (fournir IMAGE en repli).");
  return img;
}

function renderTemplate(tmplPath, vars) {
  let text = readFileSync(tmplPath, "utf8");
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`\${${k}}`).join(v);
  }
  const leftover = text.match(/\$\{[A-Z0-9_]+\}/g);
  if (leftover) die(`placeholders non résolus dans ${tmplPath} : ${[...new Set(leftover)].join(", ")}`);
  return text;
}

// Rendu + apply + poll STATUS-ONLY d'un Job in-cluster.
//
// PII-free (mesure i-infra) : le runner lit UNIQUEMENT `.status` du Job (via
// classifyJobStatus) — JAMAIS `kubectl logs` ni le stdout du pod, qui portent
// clés/tables/listings/contenu. Sur échec/timeout, on reporte « inspecter
// in-cluster » (le debug se fait au cluster, pas dans les logs du runner).
//
// failClosed=true (défaut) → die() sur échec/timeout (étape avortée).
// failClosed=false → renvoie { ok, state, jobName } sans die (l'appelant tranche,
// ex. S1 qui doit re-suspendre le CronJob avant de conclure).
function runJobFromTemplate({ tmpl, jobName, vars, timeoutSec, failClosed = true }) {
  const ns = vars.NAMESPACE;
  const dir = workdir();
  const rendered = join(dir, `${jobName}.rendered.yaml`);
  writeFileSync(rendered, renderTemplate(join(import.meta.dirname, tmpl), vars), { mode: 0o600 });
  // Jobs immuables : on supprime l'éventuelle instance précédente (idempotent).
  run("kubectl", ["-n", ns, "delete", "job", jobName, "--ignore-not-found"], { allowFail: true });
  run("kubectl", ["-n", ns, "apply", "-f", rendered]);
  const inspect = `inspecter in-cluster : kubectl -n ${ns} logs job/${jobName} --all-containers`;
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    // STATUS-ONLY : un seul get -o json, interprété par classifyJobStatus.
    const st = run("kubectl", ["-n", ns, "get", "job", jobName, "-o", "jsonpath={.status}"], { capture: true, allowFail: true });
    let status = {};
    try { status = st.stdout && st.stdout.trim() ? JSON.parse(st.stdout) : {}; } catch { status = {}; }
    const v = classifyJobStatus(status);
    if (v.done && v.ok) { log(`Job ${jobName} terminé OK (.status=succeeded)`); return { ok: true, state: "succeeded", jobName }; }
    if (v.done && !v.ok) {
      const msg = `Job ${jobName} en ÉCHEC (.status=failed) — étape avortée (fail-closed). ${inspect} (0 logs runner).`;
      if (!failClosed) { warn(msg); return { ok: false, state: "failed", jobName }; }
      die(msg);
    }
    if (Date.now() >= deadline) {
      const msg = `Job ${jobName} non terminé dans ${timeoutSec}s — étape avortée. ${inspect} (0 logs runner).`;
      if (!failClosed) { warn(msg); return { ok: false, state: "timeout", jobName }; }
      die(msg);
    }
    // Attente passive sans dépendance : petite boucle bloquante native.
    spawnSync("bash", ["-lc", "sleep 10"], { stdio: "ignore" });
  }
}

// =============================================================================
// S2c — migrate : Job in-cluster `node dist/db/migrate.js` (patron 36) contre
// préprod, APRÈS S2. C'est le TEST iso-prod (delta migrations `main` sur données
// prod). node ... migrate = via l'existant (image radar-api préprod).
// =============================================================================
function cmdMigrate() {
  section("S2c migrate préprod (iso-prod)");
  assertConfirm(); // G3
  const ns = opt("PREPROD_NAMESPACE", "radar-immobilier-preprod");
  const image = resolvePreprodImage(ns);
  runJobFromTemplate({
    tmpl: "db-migrate-job.tmpl.yaml",
    jobName: "radar-db-migrate-bascule",
    vars: {
      NAMESPACE: ns,
      IMAGE: image,
      DB_SECRET: opt("DB_SECRET", "radar-db-credentials"),
      // Aligné sur radar-refresh-pv (#738) : creds S3 = radar-docs-s3-credentials
      // (clés DOCS_S3_*). L'ancien secret S3 par défaut avait un access-key bidon
      // (len-19) ; mount-only si db-migrate n'exerce pas S3, wiring corrigé.
      S3_SECRET: opt("S3_SECRET", "radar-docs-s3-credentials"),
      TTL_SECONDS: opt("JOB_TTL_SECONDS", "3600"),
    },
    timeoutSec: Number(opt("MIGRATE_TIMEOUT", "900")),
  });
  log("S2c migrate OK — delta migrations appliqué sur données prod (iso-prod).");
}

// =============================================================================
// S3/S4 — copie docs : Job PRÉPROD aws-cli (pré-check GET fail-closed + s3 sync
// server-side, additif). 0 S3 runner. DRY (env DRY=1) : le runner ne touchant
// plus S3, la copie réelle n'est PAS jouée (dispatchée en exécution) ; le signal
// DRY est porté par le Job recon (informatif, `continue-on-error` côté workflow).
// =============================================================================
function cmdCopyDocs() {
  const dry = opt("DRY", "") === "1" || process.argv.includes("--dry");
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  if (dry) {
    log("S3 DRY — copie docs réelle NON jouée (0 S3 runner ; dispatchée en exécution). Signal DRY = Job recon informatif.");
    return;
  }
  // Copie réelle = Job PRÉPROD (Option A canonique, co-val k8s) : image radar-api
  // (aws-sdk `CopyObject`, 0 python), identité PROD-OWNER ÉPHÉMÈRE
  // (radar-docs-src-preprod, créée par k8s au GO / GC par ownerRef du Job) →
  // pré-check GET prod fail-closed, puis boucle List(prod) → CopyObject(préprod,
  // GrantFullControl id=<canonical préprod>) SERVER-SIDE (0 octet pod), idempotent.
  // La CI dispatche + lit .status ; AUCUNE opération secret (0 droit secrets runner).
  section("S3 copie docs — Job in-cluster (radar-api aws-sdk CopyObject + grant, additif)");
  assertConfirm(); // G3 pour la copie réelle
  const ns = opt("PREPROD_NAMESPACE", "radar-immobilier-preprod");
  const jd = jobDefaults();
  const image = resolvePreprodImage(ns);
  runJobFromTemplate({
    tmpl: "docs-sync-job.tmpl.yaml",
    // NOM EXACT figé (co-val k8s) : k8s watch `docs-sync-prod-to-preprod` pour
    // lire l'UID du Job et créer le secret radar-docs-src-preprod ownerRef=UID.
    jobName: "docs-sync-prod-to-preprod",
    vars: {
      NAMESPACE: jd.NAMESPACE,
      IMAGE: image,
      DOCS_SYNC_READ_SECRET: jd.DOCS_SYNC_READ_SECRET,
      S3_ENDPOINT: jd.S3_ENDPOINT,
      S3_REGION: jd.S3_REGION,
      S3_FORCE_PATH_STYLE: opt("DOCS_S3_FORCE_PATH_STYLE", "true"),
      SRC_BUCKET: prod,
      DST_BUCKET: preprod,
      COPY_GRANTEE: jd.DOCS_SYNC_GRANTEE,
      COPY_PREFIX: opt("DOCS_SYNC_PREFIX", ""),
    },
    timeoutSec: Number(opt("COPYDOCS_TIMEOUT", "1800")),
  });
  log("S3 copie OK — docs prod → préprod (Job radar-api aws-sdk CopyObject + grant, additif). 0 S3 runner.");
}

// =============================================================================
// S3b — recon (dest ⊇ src) : Job PRÉPROD aws-cli (list-objects-v2 diff Key+Size) qui EXIT
// 0 si rien à copier (dest ⊇ src), EXIT 1 si des objets manquent en préprod. Le
// runner ne lit que `.status` (0 listing runner). Sur succès, écrit un sentinel
// LOCAL recon.ok.json (verdict, PAS de contenu S3) consommé par la GARDE G4.
// =============================================================================
function cmdRecon() {
  section("S3b recon (dest ⊇ src) — Job in-cluster (list-objects-v2 diff Key+Size, verdict-only)");
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  dispatchS3Check({
    mode: "recon",
    jobName: "radar-bascule-recon",
    // Secret PERSISTANT radar-docs-reader-preprod (RO-reader, LIST prod+préprod docs) — PAS la
    // cred docs-sync éphémère. Overridable via CHECK_DOCS_SECRET.
    secret: jobDefaults().CHECK_DOCS_SECRET,
    params: { srcBucket: prod, dstBucket: preprod },
    timeoutSec: Number(opt("RECON_TIMEOUT", "600")),
  });
  const dir = workdir();
  const sentinel = { ok: true, prod, preprod, at: new Date().toISOString() };
  writeFileSync(join(dir, "recon.ok.json"), `${JSON.stringify(sentinel)}\n`, { mode: 0o600 });
  log("S3b recon OK — Job dry-run VIDE (dest ⊇ src, verdict .status). Sentinel recon.ok écrit (0 listing runner).");
}

// =============================================================================
// GARDE G4 — le flip (S5) ne part QUE si recon (S3b) a réussi. Le sentinel LOCAL
// (verdict, PAS de contenu S3) est vérifié, puis la recon est REJOUÉE en direct
// (Job list-objects-v2 diff Key+Size) — verdict .status uniquement, 0 listing runner.
// =============================================================================
function assertReconOk() {
  const dir = workdir();
  const path = join(dir, "recon.ok.json");
  if (!existsSync(path)) die("GARDE G4 — sentinel recon.ok absent : lancer recon (S3b) et l'obtenir VERT avant le flip.");
  let s;
  try { s = JSON.parse(readFileSync(path, "utf8")); } catch { die("GARDE G4 — sentinel recon.ok illisible."); }
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  if (!s.ok || s.prod !== prod || s.preprod !== preprod) {
    die("GARDE G4 — sentinel recon.ok ne correspond pas aux buckets courants : recon à rejouer.");
  }
  // Défense en profondeur : on rejoue la recon (Job) juste avant le flip.
  cmdRecon();
  log("GARDE G4 OK — recon confirmé vert (Job) immédiatement avant le flip.");
}

// =============================================================================
// S5 — flip serving : retrait du littéral drift GEO_DOCUMENTS_REPOINT →
// défaut « 0 » = OFF = iso-prod (réversible). Idempotent (remove-if-present).
// Pas ISOLABLE : dépend de kubectl préprod (RBAC enabler k8s).
// =============================================================================
function cmdFlip() {
  section("S5 flip serving (retrait GEO_DOCUMENTS_REPOINT)");
  assertConfirm(); // G3
  assertReconOk(); // G4 — S5 seulement si S3b exit 0
  const ns = opt("PREPROD_NAMESPACE", "radar-immobilier-preprod");
  const varName = opt("REPOINT_VAR", "GEO_DOCUMENTS_REPOINT");
  const deploy = opt("FLIP_DEPLOY", "radar-api");
  // `set env ... VAR-` retire la variable si présente (no-op sinon) → défaut OFF.
  run("kubectl", ["-n", ns, "set", "env", `deploy/${deploy}`, `${varName}-`]);
  log(`S5 flip OK — ${varName} retiré de deploy/${deploy} (défaut OFF = iso-prod, réversible).`);
}

// =============================================================================
// S6 — refresh différentiel : Job one-off worker-live.js en mode delta (lit
// runs/ préprod = état prod ; PAS --all). Le CronJob refresh reste suspendu.
// =============================================================================
function cmdRefresh() {
  section("S6 refresh différentiel (worker-live delta)");
  assertConfirm(); // G3
  const ns = opt("PREPROD_NAMESPACE", "radar-immobilier-preprod");
  // MEDIUM 2 (classe du bug Farid) — la cible d'écriture du refresh DOIT être le
  // bucket SERVI config-driven (ConfigMap radar-api, #738), pas un SCRAPE_S3_BUCKET
  // divergent : sinon les nouveaux PV atterrissent là où l'API ne LIT pas → re-404.
  const assertBucket = opt("ASSERT_REFRESH_BUCKET", "1") !== "0";
  const servedKey = opt("REFRESH_SERVED_BUCKET_KEY", "SCRAPE_S3_BUCKET");
  const served = opt("PREPROD_DOCS", "");
  const cmBucket = run("kubectl", ["-n", ns, "get", "cm", "radar-api", "-o", `jsonpath={.data.${servedKey}}`], { capture: true, allowFail: true }).stdout.trim();
  if (assertBucket) {
    if (!cmBucket) die(`MEDIUM2 — ConfigMap radar-api préprod sans clé ${servedKey} : cible d'écriture du refresh non garantie (ASSERT_REFRESH_BUCKET=0 pour forcer).`);
    if (served && cmBucket !== served) {
      die(
        `MEDIUM2 — cible d'écriture refresh DIVERGENTE : ConfigMap ${servedKey}='${cmBucket}' ≠ ` +
          `bucket servi PREPROD_DOCS='${served}'. Le refresh écrirait hors served bucket (re-404). ` +
          `Aligner le ConfigMap radar-api préprod sur le bucket servi avant S6.`,
      );
    }
    log(`MEDIUM2 OK — refresh écrira dans le bucket servi config-driven (${servedKey}='${cmBucket}').`);
  } else {
    warn(`MEDIUM2 — assertion bucket refresh désactivée ; ConfigMap ${servedKey}='${cmBucket || "<absent>"}', servi='${served || "<non fourni>"}'.`);
  }
  // MEDIUM 3 — mémoire de collecte : le préfixe `runs/` DOIT être présent dans le
  // bucket servi (PREPROD_DOCS) avant le delta, sinon worker-live rescrape tout.
  // Le workflow joue déjà `precheck-runs` (Job) entre S3 et S6 ; on re-vérifie ici
  // (défense en profondeur) en dispatchant le MÊME Job runs verdict-only — 0 S3
  // runner. Échappatoire documentée : ASSERT_RUNS_MEMORY=0 (dégrade en warning).
  if (opt("ASSERT_RUNS_MEMORY", "1") !== "0") {
    dispatchS3Check({
      mode: "runs",
      jobName: "radar-bascule-runs-preprod",
      secret: jobDefaults().CHECK_DOCS_SECRET, // radar-docs-reader-preprod (RO-reader persistant)
      params: { bucket: req("PREPROD_DOCS"), prefix: opt("RUNS_PREFIX", "runs/") },
      timeoutSec: Number(opt("CHECK_TIMEOUT", "180")),
    });
    log("MEDIUM3 OK — 'runs/' peuplé (Job verdict) : le refresh fera un DELTA.");
  } else {
    warn("MEDIUM3 — pré-check runs/ (mémoire de collecte) DÉSACTIVÉ (ASSERT_RUNS_MEMORY=0).");
  }
  const image = resolvePreprodImage(ns);
  runJobFromTemplate({
    tmpl: "refresh-job.tmpl.yaml",
    jobName: "radar-refresh-bascule",
    vars: {
      NAMESPACE: ns,
      IMAGE: image,
      DB_SECRET: opt("DB_SECRET", "radar-db-credentials"),
      // Alignement sur le CronJob radar-refresh-pv préprod QUI MARCHE (#738) :
      // creds S3 = radar-docs-s3-credentials (clés DOCS_S3_*). L'ancien secret S3
      // par défaut avait un access-key BIDON (seul S6 le lisait) et l'ancien secret
      // scrape est ABSENT en préprod → l'ancien défaut bloquait le RUN. Overridable.
      S3_SECRET: opt("S3_SECRET", "radar-docs-s3-credentials"),
      SCRAPE_S3_SECRET: opt("SCRAPE_S3_SECRET", "radar-docs-s3-credentials"),
      TTL_SECONDS: opt("JOB_TTL_SECONDS", "3600"),
    },
    timeoutSec: Number(opt("REFRESH_TIMEOUT", "3600")),
  });
  log("S6 refresh OK — delta worker-live joué (aucun --all ; CronJob refresh laissé suspendu).");
}

// =============================================================================
// S7 — smoke : curl préprod/health, assert db.ok + objectStore.ok
// =============================================================================
function cmdSmoke() {
  section("S7 smoke préprod/health");
  const url = req("PREPROD_HEALTH_URL");
  const r = run("curl", ["-fsS", "--max-time", "20", url], { capture: true, allowFail: true });
  if (r.status !== 0) die(`smoke KO — /health injoignable (${url}).`);
  let body;
  try { body = JSON.parse(r.stdout); } catch { die(`smoke KO — réponse /health non JSON : ${r.stdout.slice(0, 200)}`); }
  const dbOk = body?.db?.ok === true;
  const osOk = body?.objectStore?.ok === true;
  log(`/health → status=${body?.status} sha=${body?.sha} db.ok=${dbOk} objectStore.ok=${osOk}`);
  if (!dbOk || !osOk) die("smoke KO — db.ok et/ou objectStore.ok ≠ true.");
  log("S7 smoke OK — db.ok + objectStore.ok. (UAT Farid = hors script.)");
}

// =============================================================================
// force-refresh — PRÉCIPITE un run du CronJob préprod `radar-refresh-pv` à la
// demande (hors planning 5/11/17/23h), 100% code-driven (complément owner CD).
//
// Le runner reste kubectl-only + STATUS-ONLY (0 S3/DB runner, 0 `kubectl logs`) :
//   `kubectl create job <name> --from=cronjob/radar-refresh-pv` lit le jobTemplate
//   du CronJob (MÊME s'il est suspendu → précipitation possible hors créneau) et
//   crée un Job one-off ; le Job tourne sous `serviceAccountName: radar-app`
//   (creds in-cluster via secretKeyRef, jamais côté runner). Le runner ne lit que
//   `.status` (classifyJobStatus). À jouer APRÈS la bascule (données prod
//   restaurées en préprod) — l'ordre est câblé côté workflow (needs: bascule).
//
// Le balayage refresh-pv peut durer ~5 h (activeDeadlineSeconds 19800) : par
// défaut on CONFIRME un démarrage propre (Active/succeeded, borné
// FORCE_REFRESH_START_CONFIRM_SEC) puis on rend la main VERT (async, sémantique
// CronJob) ; FORCE_REFRESH_WAIT_COMPLETE=1 attend la fin (fail-closed).
// =============================================================================

// Pure : nom de Job RFC1123 sûr dérivé d'un suffixe (run id / horodatage).
// Exportée pour le self-test (déterminisme + borne 63 car + charset [a-z0-9-],
// pas de tiret en tête/fin même après troncature).
export function refreshJobName(suffix) {
  const base = "radar-refresh-pv-forced";
  const clean = String(suffix ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = clean ? `${base}-${clean}` : base;
  return name.slice(0, 63).replace(/-+$/g, "");
}

function cmdForceRefresh() {
  section("force-refresh — précipiter le CronJob préprod radar-refresh-pv (hors planning)");
  const ns = opt("PREPROD_NAMESPACE", "radar-immobilier-preprod");
  const cronjob = opt("REFRESH_CRONJOB", "radar-refresh-pv");
  const suffix = opt("GITHUB_RUN_ID", "") || new Date().toISOString().replace(/[:.]/g, "-");
  const jobName = refreshJobName(suffix);
  const startConfirmSec = Number(opt("FORCE_REFRESH_START_CONFIRM_SEC", "180"));
  const waitComplete = opt("FORCE_REFRESH_WAIT_COMPLETE", "0") === "1";
  const completeTimeoutSec = Number(opt("FORCE_REFRESH_TIMEOUT_SEC", "21600")); // 6 h

  // Le CronJob doit exister (activé par l'overlay préprod refresh-cronjobs).
  // Fail-closed : sans lui, `--from=cronjob` échouerait sans signal clair.
  const exists = run("kubectl", ["-n", ns, "get", "cronjob", cronjob, "-o", "name"], { capture: true, allowFail: true });
  if (exists.status !== 0) {
    die(
      `force-refresh — CronJob ${ns}/${cronjob} introuvable : l'overlay préprod doit l'avoir activé ` +
        `(step CD « Deploy refresh CronJobs (preprod) », armé par REFRESH_CRONJOB_PREPROD_ENABLED). ` +
        `Détail : ${(exists.stderr || "").trim() || "not found"}`,
    );
  }

  // Job immuable : purge une éventuelle instance homonyme (rejeu) puis crée depuis
  // le CronJob. create --from=cronjob ignore spec.suspend (précipitation à la demande).
  run("kubectl", ["-n", ns, "delete", "job", jobName, "--ignore-not-found"], { allowFail: true });
  run("kubectl", ["-n", ns, "create", "job", jobName, `--from=cronjob/${cronjob}`]);
  log(`Job ${ns}/${jobName} créé depuis cronjob/${cronjob} — refresh précipité (hors planning).`);

  const deadline = Date.now() + (waitComplete ? completeTimeoutSec : startConfirmSec) * 1000;
  for (;;) {
    const st = run("kubectl", ["-n", ns, "get", "job", jobName, "-o", "jsonpath={.status}"], { capture: true, allowFail: true });
    let status = {};
    try { status = st.stdout && st.stdout.trim() ? JSON.parse(st.stdout) : {}; } catch { status = {}; }
    const v = classifyJobStatus(status);
    if (v.done && v.ok) { log(`force-refresh OK — Job ${jobName} terminé (.status=succeeded).`); return; }
    if (v.done && !v.ok) {
      die(`force-refresh — Job ${jobName} en ÉCHEC (.status=failed) — inspecter in-cluster : kubectl -n ${ns} logs job/${jobName} (0 logs runner).`);
    }
    if (Date.now() >= deadline) {
      if (waitComplete) {
        die(`force-refresh — Job ${jobName} non terminé dans ${completeTimeoutSec}s (FORCE_REFRESH_WAIT_COMPLETE=1) — inspecter in-cluster (0 logs runner).`);
      }
      // Démarrage confirmé sans échec : le balayage se poursuit en tâche de fond
      // (sémantique CronJob). VERT (async) — suivi via le rapport durable
      // refresh/018/sweep/latest.json et `kubectl get job`.
      log(`force-refresh OK (async) — Job ${jobName} démarré (.status=${v.state}) ; le balayage continue en tâche de fond. Suivi : kubectl -n ${ns} get job ${jobName}.`);
      return;
    }
    spawnSync("bash", ["-lc", "sleep 10"], { stdio: "ignore" });
  }
}

// =============================================================================
// dispatch
// =============================================================================
const COMMANDS = {
  preflight: cmdPreflight,
  quiesce: cmdQuiesce,
  dump: cmdDump,
  restore: cmdRestore,
  migrate: cmdMigrate,
  "copy-docs": cmdCopyDocs,
  recon: cmdRecon,
  "precheck-runs": cmdPrecheckRuns,
  flip: cmdFlip,
  unquiesce: cmdUnquiesce,
  refresh: cmdRefresh,
  "force-refresh": cmdForceRefresh,
  smoke: cmdSmoke,
};

function main() {
  const cmd = process.argv[2];
  const isHelp = !cmd || cmd === "-h" || cmd === "--help";
  if (isHelp || !COMMANDS[cmd]) {
    console.log(
      "usage: node bascule.mjs <preflight|quiesce|dump|restore|migrate|copy-docs|recon|precheck-runs|flip|unquiesce|refresh|force-refresh|smoke>\n" +
        "  RUNNER KUBECTL-ONLY : 0 cred S3, 0 pg_dump/pg_restore, 0 listing/clé sur le runner.\n" +
        "    Toute S3/DB vit dans des Jobs préprod verdict-only ; le runner ne lit que .status (0 kubectl logs).\n" +
        "  force-refresh : précipite le CronJob préprod radar-refresh-pv à la demande (kubectl create job\n" +
        "    --from=cronjob), hors planning 5/11/17/23h. À jouer APRÈS la bascule (ordre câblé côté workflow).\n" +
        "  dump (S1) : DÉCLENCHEUR — patch CronJob prod suspend=false (kubeconfig PROD), Job freshness\n" +
        "    (poll interne, verdict), re-suspend. Dump réel = CronJob owner (radar-db-backup-prod).\n" +
        "  restore (S2) : G2 quiesce + G1 Job rollback préprod, puis Job restore (fetch self-select + pg_restore).\n" +
        "  copy-docs (S3) : Job aws-cli (pré-check GET + s3 sync additif) ; DRY=1 → copie non jouée (0 S3 runner).\n" +
        "  recon (S3b) / precheck-runs (S3c) : Jobs verdict-only (list-objects-v2 diff Key+Size / list runs/).\n" +
        "    precheck cible défaut = PREPROD_DOCS (gate) ; --prod = PROD_DOCS (advisory via workflow continue-on-error).\n" +
        "  quiesce/unquiesce : met/rétablit les consommateurs préprod (unquiesce = reprise, sans CONFIRM).\n" +
        "  GARDES fail-closed : G1 rollback préprod (Job), G2 quiesce, G3 CONFIRM, G4 recon-avant-flip,\n" +
        "    EXPECTED_DATABASE (Jobs freshness/restore : clé + header archive), précheck runs/ avant refresh.",
    );
    process.exit(isHelp ? 0 : 1); // help = 0 ; commande inconnue = 1 (fail-closed)
  }
  COMMANDS[cmd]();
}

// N'exécute la CLI que si invoqué directement (`node bascule.mjs …`) — un import
// (self-test des fonctions pures ci-dessus) ne doit PAS déclencher main().
const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) main();
