#!/usr/bin/env node
// =============================================================================
// bascule.mjs — BASCULE PROD → PRÉPROD (« iso-prod »), CLI natif, 0 Python.
//
// Orchestre, en Node pur (aucune IA au runtime), la séquence S0→S7 fournie par
// i-infra : sauvegarde prod → restauration préprod → migrations → copie docs →
// recon → flip serving → refresh différentiel → smoke. Rejouable par la CI immo
// / l'owner SANS IA (OPS-3), avec des gardes fail-closed en Node.
//
// Le CLI ne fait qu'INVOQUER les outils natifs via child_process — il ne parle
// jamais SQL/S3 lui-même : pg_dump / pg_restore (postgresql-client 16), s5cmd
// (copie + diff/recon server-side), kubectl (flip + Jobs migrate/refresh),
// curl (smoke). Toute la LOGIQUE et toutes les GARDES sont ici, en Node ; le
// workflow GitHub reste fin.
//
//   Sous-commandes :
//     preflight    S0  — prérequis binaires + secrets + EXPECTED_DATABASE.
//     dump         S1  — pg_dump prod (custom, --no-owner --no-privileges), T0.
//     restore      S2  — GARDES puis pg_restore préprod (rollback d'abord).
//     migrate      S2c — Job in-cluster `node dist/db/migrate.js` (patron 36).
//     copy-docs    S3  — s5cmd sync server-side (additif) ; --dry pour le DRY.
//     recon        S3b — s5cmd --dry-run sync, assert sortie VIDE (dest ⊇ src).
//     flip         S5  — kubectl set env deploy/radar-api GEO_DOCUMENTS_REPOINT-
//     refresh      S6  — Job in-cluster worker-live.js en mode delta (PAS --all).
//     smoke        S7  — curl préprod/health (db.ok + objectStore.ok).
//
//   GARDES fail-closed (clé OPS-3) :
//     G1  restore refuse de partir sans dump rollback préprod réussi d'abord.
//     G2  restore refuse si les consommateurs préprod ne sont pas quiesce
//         (Deployments scale 0 + CronJobs suspend).
//     G3  CONFIRM explicite (input workflow_dispatch, ex. iso-prod-<date>) —
//         sans quoi aucune étape mutante ne s'exécute.
//     G4  flip ne s'exécute QUE si recon (S3b) a produit un sentinel exit 0.
//     +   EXPECTED_DATABASE : contrôle POSITIF de la DB source avant dump.
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
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";

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

// ── env libpq par rôle (jamais d'URI mot-de-passe en clair) ─────────────────
// prod   : PROD_PG* (RO)   → PG* pour l'enfant.
// preprod: PREPROD_PG*     → PG* pour l'enfant.
function pgEnv(role) {
  const p = role === "prod" ? "PROD_" : "PREPROD_";
  return {
    PGHOST: req(`${p}PGHOST`),
    PGPORT: opt(`${p}PGPORT`, "5432"),
    PGUSER: req(`${p}PGUSER`),
    PGPASSWORD: req(`${p}PGPASSWORD`),
    PGDATABASE: req(`${p}PGDATABASE`),
    // Sûreté réseau : refuse une connexion en clair si le serveur l'exige,
    // et borne le temps de connexion pour ne pas pendre le runner.
    PGCONNECT_TIMEOUT: opt(`${p}PGCONNECT_TIMEOUT`, "15"),
  };
}

// ── répertoire de travail (dumps, sentinels) — persiste dans un run de job ──
function workdir() {
  const dir = opt("BASCULE_WORKDIR", join(process.cwd(), ".bascule-work"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── s5cmd : env AWS_* (identité spanning) + endpoint BHS ────────────────────
function s5Env() {
  return {
    AWS_ACCESS_KEY_ID: req("AWS_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: req("AWS_SECRET_ACCESS_KEY"),
    AWS_REGION: opt("AWS_REGION", ""),
  };
}

// =============================================================================
// S0 — preflight : binaires + secrets + EXPECTED_DATABASE
// =============================================================================
function cmdPreflight() {
  section("S0 preflight");
  const bins = ["pg_dump", "pg_restore", "s5cmd", "node", "kubectl", "curl"];
  const missing = bins.filter((b) => run("bash", ["-lc", `command -v ${b}`], { capture: true, allowFail: true }).status !== 0);
  if (missing.length) die(`binaires manquants sur le runner : ${missing.join(", ")}`);
  log(`binaires présents : ${bins.join(", ")}`);

  // pg-client 16 attendu (custom-format cross-version : dump 16 → restore 16).
  const pv = run("pg_dump", ["--version"], { capture: true }).stdout.trim();
  log(`pg client : ${pv}`);

  // Secrets/params indispensables (présence seule — jamais la valeur).
  const required = [
    "EXPECTED_DATABASE",
    "PROD_PGHOST", "PROD_PGUSER", "PROD_PGPASSWORD", "PROD_PGDATABASE",
    "PREPROD_PGHOST", "PREPROD_PGUSER", "PREPROD_PGPASSWORD", "PREPROD_PGDATABASE",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BHS", "PROD_DOCS", "PREPROD_DOCS",
  ];
  const absent = required.filter((k) => !process.env[k]);
  if (absent.length) die(`secrets/paramètres CI absents : ${absent.join(", ")}`);
  log(`secrets/paramètres présents : ${required.length} clés`);

  // Contrôle POSITIF : la DB source déclarée == EXPECTED_DATABASE (nom DB prod).
  if (process.env.PROD_PGDATABASE !== process.env.EXPECTED_DATABASE) {
    die(
      `contrôle positif KO — PROD_PGDATABASE='${process.env.PROD_PGDATABASE}' ≠ ` +
        `EXPECTED_DATABASE='${process.env.EXPECTED_DATABASE}'. On refuse de dumper la mauvaise DB.`,
    );
  }
  log("contrôle positif OK — la DB source correspond à EXPECTED_DATABASE");
  log("S0 preflight OK");
}

// =============================================================================
// S1 — dump prod : pg_dump custom, snapshot MVCC cohérent, T0 = label
// =============================================================================
function cmdDump() {
  section("S1 dump prod");
  assertConfirm(); // le dump ouvre la séquence armée
  const expected = req("EXPECTED_DATABASE");
  const env = pgEnv("prod");
  // Contrôle positif AVANT toute lecture : bonne DB source.
  if (env.PGDATABASE !== expected) {
    die(`GARDE source — PGDATABASE='${env.PGDATABASE}' ≠ EXPECTED_DATABASE='${expected}'`);
  }
  const dir = workdir();
  const t0 = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(dir, "T0.txt"), `${t0}\n`, { mode: 0o600 });
  const out = join(dir, `prod-${t0}.dump`);
  log(`T0=${t0} → ${out}`);
  // --format=custom : dump transactionnel (snapshot MVCC cohérent, pas besoin de
  // pg_export_snapshot) ; --no-owner --no-privileges : restaurable tel quel en
  // préprod sans les rôles prod.
  run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--verbose",
    "--file", out,
  ], { env });
  // Vérifie que le dump est lisible (TOC) et enregistre le pointeur courant.
  run("pg_restore", ["--list", out], { capture: true });
  writeFileSync(join(dir, "LATEST_PROD_DUMP.txt"), `${out}\n`, { mode: 0o600 });
  const bytes = statSync(out).size;
  if (bytes <= 0) die("dump prod vide");
  log(`S1 dump OK — ${bytes} octets, TOC lisible`);
}

// =============================================================================
// GARDE G2 — quiesce : consommateurs préprod scale 0 / suspend (kubectl RO)
// =============================================================================
function assertQuiesced() {
  const ns = opt("PREPROD_NAMESPACE", "radar-immobilier-preprod");
  const deployments = opt("QUIESCE_DEPLOYMENTS", "radar-api,radar-immo-mcp").split(",").map((s) => s.trim()).filter(Boolean);
  const cronjobs = opt("QUIESCE_CRONJOBS", "radar-refresh-pv,radar-consistency-snapshot,radar-populate-geo-daily").split(",").map((s) => s.trim()).filter(Boolean);
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
      for (const j of items) {
        const name = j?.metadata?.name ?? "<sans-nom>";
        const st = j?.status ?? {};
        const nActive = Number(st.active ?? 0);
        if (Number.isFinite(nActive) && nActive > 0) active.push(`${name} (active=${nActive})`);
      }
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
    for (const c of cronjobs) {
      const r = run("kubectl", ["-n", ns, "get", "cronjob", c, "-o", "jsonpath={.spec.suspend}"], { capture: true });
      state.cronjobs[c] = (r.stdout || "").trim() === "true";
    }
    writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    log(`état d'origine enregistré → ${statePath}`);
  }
  // Appliquer le quiesce (idempotent).
  for (const d of deployments) run("kubectl", ["-n", ns, "scale", `deploy/${d}`, "--replicas=0"]);
  for (const c of cronjobs) run("kubectl", ["-n", ns, "patch", "cronjob", c, "-p", '{"spec":{"suspend":true}}']);
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
// S2 — restore préprod : GARDES d'abord, puis pg_restore destructif
// =============================================================================
function cmdRestore() {
  section("S2 restore préprod");
  assertConfirm(); // G3
  const dir = workdir();
  // Le dump prod produit par S1 (ou fourni via PROD_DUMP).
  const prodDump = opt("PROD_DUMP", existsSync(join(dir, "LATEST_PROD_DUMP.txt")) ? readFileSync(join(dir, "LATEST_PROD_DUMP.txt"), "utf8").trim() : "");
  if (!prodDump || !existsSync(prodDump)) die("dump prod introuvable — lancer 'dump' (S1) d'abord ou fournir PROD_DUMP.");

  // Pré-check : TOC lisible AVANT tout load destructif.
  run("pg_restore", ["--list", prodDump], { capture: true });
  log(`dump prod OK (TOC lisible) : ${prodDump}`);

  const env = pgEnv("preprod");

  // GARDE G2 — quiesce des consommateurs préprod (avant tout write).
  assertQuiesced();

  // GARDE G1 — dump rollback de la DB préprod AVANT le restore destructif.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rollback = join(dir, `preprod-rollback-${ts}.dump`);
  log(`GARDE G1 — dump rollback préprod → ${rollback}`);
  run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", rollback], { env });
  if (!existsSync(rollback) || statSync(rollback).size <= 0) die("GARDE G1 — dump rollback préprod vide/absent : restore refusé.");
  run("pg_restore", ["--list", rollback], { capture: true }); // rollback lisible
  writeFileSync(join(dir, "LATEST_PREPROD_ROLLBACK.txt"), `${rollback}\n`, { mode: 0o600 });
  log(`GARDE G1 OK — rollback préprod capturé (${statSync(rollback).size} octets, TOC lisible)`);

  // Restore destructif fail-closed : --single-transaction + --exit-on-error →
  // tout-ou-rien ; --clean --if-exists = remplacement idempotent.
  log("pg_restore préprod (--clean --if-exists --single-transaction --exit-on-error) …");
  run("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "--single-transaction",
    "--dbname", env.PGDATABASE,
    prodDump,
  ], { env });
  log("S2 restore OK — données prod chargées en préprod (rollback disponible).");
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

function runJobFromTemplate({ tmpl, jobName, vars, timeoutSec }) {
  const ns = vars.NAMESPACE;
  const dir = workdir();
  const rendered = join(dir, `${jobName}.rendered.yaml`);
  writeFileSync(rendered, renderTemplate(join(import.meta.dirname, tmpl), vars), { mode: 0o600 });
  // Jobs immuables : on supprime l'éventuelle instance précédente (idempotent).
  run("kubectl", ["-n", ns, "delete", "job", jobName, "--ignore-not-found"], { allowFail: true });
  run("kubectl", ["-n", ns, "apply", "-f", rendered]);
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const succ = run("kubectl", ["-n", ns, "get", "job", jobName, "-o", "jsonpath={.status.succeeded}"], { capture: true, allowFail: true }).stdout.trim();
    const fail = run("kubectl", ["-n", ns, "get", "job", jobName, "-o", "jsonpath={.status.failed}"], { capture: true, allowFail: true }).stdout.trim();
    if (succ && Number(succ) >= 1) { log(`Job ${jobName} terminé OK`); break; }
    if (fail && Number(fail) >= 1) {
      run("kubectl", ["-n", ns, "logs", `job/${jobName}`, "--all-containers=true", "--tail=80"], { allowFail: true });
      die(`Job ${jobName} en ÉCHEC — étape avortée (fail-closed).`);
    }
    if (Date.now() >= deadline) {
      run("kubectl", ["-n", ns, "logs", `job/${jobName}`, "--all-containers=true", "--tail=80"], { allowFail: true });
      die(`Job ${jobName} non terminé dans ${timeoutSec}s — étape avortée.`);
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
      S3_SECRET: opt("S3_SECRET", "radar-s3-credentials"),
      TTL_SECONDS: opt("JOB_TTL_SECONDS", "3600"),
    },
    timeoutSec: Number(opt("MIGRATE_TIMEOUT", "900")),
  });
  log("S2c migrate OK — delta migrations appliqué sur données prod (iso-prod).");
}

// =============================================================================
// S3 — copie docs : s5cmd sync server-side (CopyObject same-endpoint), additif.
// --dry (env DRY=1) → même commande en --dry-run (0 octet, sans écriture).
// =============================================================================
function cmdCopyDocs() {
  section("S3 copie docs (s5cmd sync server-side, additif)");
  const dry = opt("DRY", "") === "1" || process.argv.includes("--dry");
  if (!dry) assertConfirm(); // G3 pour la copie réelle ; le DRY reste libre
  const bhs = req("BHS");
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  const args = ["--endpoint-url", bhs];
  if (dry) args.push("--dry-run");
  // Additif volontaire (PAS de --delete) : `runs/` vient gratis. Même endpoint →
  // s5cmd fait un CopyObject côté serveur (0 octet par le runner).
  args.push("sync", `s3://${prod}/*`, `s3://${preprod}/`);
  run("s5cmd", args, { env: s5Env() });
  log(dry ? "S3 DRY OK — plan de copie affiché, aucune écriture." : "S3 copie OK — docs prod → préprod (server-side, additif).");
}

// =============================================================================
// S3b — recon : re-jouer s5cmd --dry-run sync, ASSERTER sortie VIDE (dest ⊇ src).
// Écrit un sentinel recon.ok (consommé par la GARDE G4 du flip).
// =============================================================================
function cmdRecon() {
  section("S3b recon (dest ⊇ src)");
  const bhs = req("BHS");
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  const r = run("s5cmd", ["--endpoint-url", bhs, "--dry-run", "sync", `s3://${prod}/*`, `s3://${preprod}/`], { env: s5Env(), capture: true });
  const pending = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (pending.length > 0) {
    console.log(pending.slice(0, 50).join("\n"));
    die(`RECON FAIL — ${pending.length} objet(s) manquant(s) en préprod (dest ⊉ src). Relancer la copie (S3).`);
  }
  const dir = workdir();
  const sentinel = { ok: true, prod, preprod, bhs, at: new Date().toISOString() };
  writeFileSync(join(dir, "recon.ok.json"), `${JSON.stringify(sentinel)}\n`, { mode: 0o600 });
  log("S3b recon OK — sortie dry-run VIDE (dest ⊇ src). Sentinel recon.ok écrit.");
}

// =============================================================================
// GARDE G4 — le flip (S5) ne part QUE si recon (S3b) a réussi (sentinel + re-run).
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
  // Défense en profondeur : on rejoue la recon en direct (doit rester VIDE).
  cmdRecon();
  log("GARDE G4 OK — recon confirmé vert immédiatement avant le flip.");
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
  const image = resolvePreprodImage(ns);
  runJobFromTemplate({
    tmpl: "refresh-job.tmpl.yaml",
    jobName: "radar-refresh-bascule",
    vars: {
      NAMESPACE: ns,
      IMAGE: image,
      DB_SECRET: opt("DB_SECRET", "radar-db-credentials"),
      S3_SECRET: opt("S3_SECRET", "radar-s3-credentials"),
      SCRAPE_S3_SECRET: opt("SCRAPE_S3_SECRET", "radar-scrape-s3-credentials"),
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
  flip: cmdFlip,
  unquiesce: cmdUnquiesce,
  refresh: cmdRefresh,
  smoke: cmdSmoke,
};

function main() {
  const cmd = process.argv[2];
  const isHelp = !cmd || cmd === "-h" || cmd === "--help";
  if (isHelp || !COMMANDS[cmd]) {
    console.log(
      "usage: node bascule.mjs <preflight|quiesce|dump|restore|migrate|copy-docs|recon|flip|unquiesce|refresh|smoke>\n" +
        "  DRY=1 (ou --dry) sur copy-docs → --dry-run (0 écriture).\n" +
        "  quiesce/unquiesce : met/rétablit les consommateurs préprod (unquiesce = reprise, sans CONFIRM).\n" +
        "  GARDES fail-closed : G1 rollback préprod, G2 quiesce, G3 CONFIRM, G4 recon-avant-flip.",
    );
    process.exit(isHelp ? 0 : 1); // help = 0 ; commande inconnue = 1 (fail-closed)
  }
  COMMANDS[cmd]();
}

main();
