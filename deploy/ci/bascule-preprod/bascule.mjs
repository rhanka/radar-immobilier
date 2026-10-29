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
  const delPrev = run("kubectl", ["-n", ns, "delete", "job", jobName, "--ignore-not-found"], { allowFail: true });
  if (delPrev.status !== 0) die(`force-refresh — suppression du Job ${jobName} précédent a échoué (status ${delPrev.status}) : refusé.`);
  run("kubectl", ["-n", ns, "create", "job", jobName, `--from=cronjob/${cronjob}`]);
  log(`Job ${ns}/${jobName} créé depuis cronjob/${cronjob} — refresh précipité (hors planning).`);

  const deadline = Date.now() + (waitComplete ? completeTimeoutSec : startConfirmSec) * 1000;
  for (;;) {
    const st = run("kubectl", ["-n", ns, "get", "job", jobName, "-o", "jsonpath={.status}"], { capture: true, allowFail: true });
    let status = {};
    // Parsed only from a SUCCESSFUL read; a failed/interrupted read is pending.
    try { status = st.status === 0 && st.stdout && st.stdout.trim() ? JSON.parse(st.stdout) : {}; } catch { status = {}; }
    const v = classifyJobStatus(status);
    if (v.done && v.ok) { log(`force-refresh OK — Job ${jobName} terminé (.status=succeeded).`); return; }
    if (v.done && !v.ok) {
      die(`force-refresh — Job ${jobName} en ÉCHEC (.status=failed) — inspecter in-cluster : kubectl -n ${ns} logs job/${jobName} (0 logs runner).`);
    }
    if (Date.now() >= deadline) {
      if (waitComplete) {
        die(`force-refresh — Job ${jobName} non terminé dans ${completeTimeoutSec}s (FORCE_REFRESH_WAIT_COMPLETE=1) — inspecter in-cluster (0 logs runner).`);
      }
      if (st.status !== 0) die(`force-refresh — état du Job ${jobName} illisible (status ${st.status}) au délai : démarrage non confirmé.`);
      // Démarrage confirmé sans échec : le balayage se poursuit en tâche de fond
      // (sémantique CronJob). VERT (async) — suivi via le rapport durable
      // refresh/018/sweep/latest.json et `kubectl get job`.
      const started = v.state === "active" ? "démarré" : "créé, démarrage non confirmé";
      log(`force-refresh OK (async) — Job ${jobName} ${started} (.status=${v.state}) ; le balayage continue en tâche de fond. Suivi : kubectl -n ${ns} get job ${jobName}.`);
      return;
    }
    spawnSync("bash", ["-lc", "sleep 10"], { stdio: "ignore" });
  }
}

// =============================================================================
// failure-summary — a run that FAILS AFTER a successful S2 (inherited from the
// chain, same in MODE=restore): the un-quiesce (`always()`) puts preprod back in
// service on the database of day D while the docs copy / recon / flip may be
// incomplete, and nothing rolls back automatically. Behaviour unchanged; the run
// summary states it explicitly, with the G1 rollback procedure. Pure builder
// (exported for the selftest) + command reading the workdir pointers.
// =============================================================================
const OUTCOME_STEPS = Object.freeze(["migrate", "docs", "recon", "flip", "unquiesce", "smoke"]);

export function buildFailureSummary({ mode, backupDate = null, t1 = null, rollbackKey = null, dumpBucket = "", expectedDatabase = "",
  bhs = "", namespace = "", outcomes = {} }) {
  const oc = Object.fromEntries(OUTCOME_STEPS.map((s) => [s, String(outcomes[s] || "not run")]));
  const dayD = mode === "restore" ? `day D = ${backupDate || "unknown"} (backup)` : `day D = the prod dump of T1 ${t1 || "unknown"}`;
  const docsFlipOk = oc.docs === "success" && oc.recon === "success" && oc.flip === "success";
  const inService = oc.unquiesce === "success";
  let head;
  if (!inService) head = `Preprod restored on a database at ${dayD} but NOT back in service (un-quiesce: ${oc.unquiesce})`;
  else if (!docsFlipOk) head = `Preprod back in service on a database at ${dayD} — docs/flip INCOMPLETE`;
  else head = `Preprod back in service on a database at ${dayD} — the run failed after the flip`;
  const lines = [`### ${head}`, "", "| step | outcome |", "|---|---|", ...OUTCOME_STEPS.map((s) => `| ${s} | ${oc[s]} |`), ""];
  lines.push("Nothing was rolled back automatically (behaviour inherited from the chain).");
  if (rollbackKey) {
    lines.push("", `**G1 rollback** — the preprod database as it was before this run: \`s3://${dumpBucket}/${rollbackKey}\`.`,
      "From a workstation with the kubeconfig of the SA `radar-ci-bascule-preprod` (same vars as the job `bascule`):", "",
      "```bash",
      'export BASCULE_WORKDIR="$(mktemp -d)" MODE=chain CONFIRM="iso-prod-$(date -u +%F)" CONFIRM_EXPECTED="iso-prod-$(date -u +%F)"',
      `export DUMP_BUCKET=${dumpBucket} EXPECTED_DATABASE=${expectedDatabase} BHS=${bhs} PREPROD_NAMESPACE=${namespace}`,
      "node deploy/ci/bascule-preprod/bascule.mjs quiesce",
      `DUMP_PREFIX=${rollbackKey} T1_EPOCH=0 DUMP_KEY_ASSERT_DB=0 node deploy/ci/bascule-preprod/bascule.mjs restore`,
      "node deploy/ci/bascule-preprod/bascule.mjs unquiesce",
      "```", "",
      "`restore` first takes a new G1 rollback of the current state (a new key, never matched by the exact `DUMP_PREFIX`), " +
        "then restores exactly the key above. If the preprod database is not named `EXPECTED_DATABASE`, the archive check " +
        "refuses: add `RESTORE_ASSERT_DB=0`. Then re-run the bascule, or the docs copy + flip.");
  } else {
    lines.push("", "No G1 rollback key recorded in this run (LATEST_PREPROD_ROLLBACK_KEY.txt absent): see the artefact bascule-rollback-<run_id>.");
  }
  return { head, markdown: `${lines.join("\n")}\n` };
}

function cmdFailureSummary() {
  const dir = workdir();
  const readText = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim() : null);
  let backupDate = null;
  try { backupDate = JSON.parse(readText("backup-pin.json") || "{}").date || null; } catch { backupDate = null; }
  const safe = (v, re) => (v && re.test(v) ? v : null);
  const out = buildFailureSummary({
    mode: currentMode(),
    backupDate: safe(backupDate, /^\d{4}-\d{2}-\d{2}$/),
    t1: safe(readText("T1.txt"), /^[0-9T:.Z-]{10,40}$/),
    rollbackKey: safe(readText("LATEST_PREPROD_ROLLBACK_KEY.txt"), /^[A-Za-z0-9._/-]{1,200}$/),
    dumpBucket: opt("DUMP_BUCKET", ""),
    expectedDatabase: opt("EXPECTED_DATABASE", ""),
    bhs: opt("BHS", ""),
    namespace: opt("PREPROD_NAMESPACE", "radar-immobilier-preprod"),
    outcomes: Object.fromEntries(OUTCOME_STEPS.map((s) => [s, opt(`O_${s.toUpperCase()}`, "")])),
  });
  console.log(`::error title=bascule — failed after S2::${out.head}`);
  console.log(out.markdown);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, out.markdown, { flag: "a" });
}

// =============================================================================
// MODE=restore|list (restore-mode.mjs) — helpers injected, no circular import.
// =============================================================================
function currentMode() {
  try { return basculeMode(process.env); } catch (e) { return die(e.message); }
}
const restoreMode = makeRestoreMode({
  log, warn, die, section, req, opt, run, assertConfirm, assertQuiesced, runJobFromTemplate, jobDefaults, workdir,
  resolvePreprodImage, runRollbackG1,
});
// In-cluster Secrets (docs-sync, backup reader, copy signer) rewritten by the bascule from GitHub.
const ciSecrets = makeCiSecrets({ log, die, section, run, jobDefaults, assertConfirm: assertConfirmOnce });
// e2e O1: zone references read from the restored DB, published via ConfigMaps.
const e2eRefs = makeE2eRefs({ log, die, section, run, opt, runJobFromTemplate, jobDefaults, workdir, resolvePreprodImage });

// =============================================================================
// dispatch
// =============================================================================
const COMMANDS = {
  ...restoreMode.commands,
  ...ciSecrets.commands,
  ...e2eRefs.commands,
  confirm: cmdConfirm,
  "failure-summary": cmdFailureSummary,
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
  // Used by bascule-refresh.yml only (on-demand refresh, OUTSIDE the bascule).
  "force-refresh": cmdForceRefresh,
  smoke: cmdSmoke,
};

function main() {
  const cmd = process.argv[2];
  const isHelp = !cmd || cmd === "-h" || cmd === "--help";
  if (isHelp || !COMMANDS[cmd]) {
    console.log(
      "usage: node bascule.mjs <preflight|quiesce|dump|restore|migrate|copy-docs|recon|precheck-runs|flip|unquiesce|force-refresh|smoke>\n" +
        "  RUNNER KUBECTL-ONLY : 0 cred S3, 0 pg_dump/pg_restore, 0 listing/clé sur le runner.\n" +
        "    Toute S3/DB vit dans des Jobs préprod verdict-only ; le runner ne lit que .status (0 kubectl logs).\n" +
        "  force-refresh : précipite le CronJob préprod radar-refresh-pv à la demande (kubectl create job\n" +
        "    --from=cronjob), hors planning 5/11/17/23h. Used by bascule-refresh.yml only: the bascule never refreshes.\n" +
        "  dump (S1) : DÉCLENCHEUR — patch CronJob prod suspend=false (kubeconfig PROD), Job freshness\n" +
        "    (poll interne, verdict), re-suspend. Dump réel = CronJob owner (radar-db-backup-prod).\n" +
        "  restore (S2) : G2 quiesce + G1 Job rollback préprod, puis Job restore (fetch self-select + pg_restore).\n" +
        "  copy-docs (S3) : Job aws-cli (pré-check GET + s3 sync additif) ; DRY=1 → copie non jouée (0 S3 runner).\n" +
        "  recon (S3b) / precheck-runs (S3c) : Jobs verdict-only (list-objects-v2 diff Key+Size / list runs/).\n" +
        "    precheck cible défaut = PREPROD_DOCS (gate) ; --prod = PROD_DOCS (advisory via workflow continue-on-error).\n" +
        "  quiesce/unquiesce : met/rétablit les consommateurs préprod (unquiesce = reprise, sans CONFIRM).\n" +
        "  GARDES fail-closed : G1 rollback préprod (Job), G2 quiesce, G3 CONFIRM, G4 recon-avant-flip,\n" +
        "    EXPECTED_DATABASE (Jobs freshness/restore : clé + header archive).\n" +
        "  MODE=restore|list (restore-mode.mjs): preflight-backup | backup-resolve | backup-list |\n" +
        "    restore-backup | docs-restore [--dry] | recon-backup — restore FROM a daily backup (BACKUP_ID).",
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
