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
