  // un-quiesce: nothing recorded ⇒ nothing scaled (unless a declared manual quiesce)
  const okOutcomes = { O_MIGRATE: "success", O_RESTORE: "success", O_DOCS: "success" };
  const uqEnv = { ...env, ...okOutcomes, BASCULE_WORKDIR: join(tmp, "uq-work"), UNQUIESCE_REPLICAS: "radar-api=2" };
  const beforeUq = readFileSync(kubectlLog, "utf8").length;
  const uq = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "unquiesce"], { env: uqEnv, encoding: "utf8" });
  ok("CLI unquiesce — no quiesce recorded, SKIP_QUIESCE≠true ⇒ no-op (0 scale)", uq.status === 0 && !/scale/.test(readFileSync(kubectlLog, "utf8").slice(beforeUq)));
  const uqManual = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "unquiesce"], { env: { ...uqEnv, SKIP_QUIESCE: "true" }, encoding: "utf8" });
  ok("CLI unquiesce — declared manual quiesce (SKIP_QUIESCE=true) ⇒ UNQUIESCE_REPLICAS applied", uqManual.status === 0 && /scale deploy\/radar-api --replicas=2/.test(readFileSync(kubectlLog, "utf8").slice(beforeUq)));
  // un-quiesce: a failed CronJob suspend patch fails the step, the others are still patched
  {
    const failBin = join(tmp, "bin-patch-fail");
    mkdirSync(failBin, { recursive: true });
    const failLog = join(tmp, "kubectl-patch-fail.log");
    writeFileSync(join(failBin, "kubectl"), ["#!/usr/bin/env bash", `echo "$*" >> "${failLog}"`,
      'case "$*" in *"patch cronjob radar-refresh-pv "*) exit 1 ;; esac', "exit 0", ""].join("\n"), { mode: 0o755 });
    const uqWork = join(tmp, "uq-fail-work");
    mkdirSync(uqWork, { recursive: true });
    writeFileSync(join(uqWork, "quiesce-state.json"), JSON.stringify({ deployments: { "radar-api": 1 },
      cronjobs: { "radar-refresh-pv": false, "radar-refresh-pending-watchdog": false } }));
    const uqFail = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "unquiesce"],
      { env: { ...env, ...okOutcomes, PATH: `${failBin}:${process.env.PATH}`, BASCULE_WORKDIR: uqWork }, encoding: "utf8" });
    const fl = readFileSync(failLog, "utf8");
    ok("CLI unquiesce — failed CronJob patch ⇒ exit 1, named, remaining CronJobs still patched",
      uqFail.status === 1 && /patch cronjob\/radar-refresh-pv suspend=false/.test(uqFail.stdout + uqFail.stderr) &&
      /patch cronjob radar-refresh-pending-watchdog /.test(fl) && !/cronjob\/radar-refresh-pv suspend restauré/.test(uqFail.stdout + uqFail.stderr));
    // same contract when kubectl is killed by a signal (spawnSync status null)
    writeFileSync(join(failBin, "kubectl"), ["#!/usr/bin/env bash", `echo "$*" >> "${failLog}"`,
      'case "$*" in *"patch cronjob radar-refresh-pv "*) kill -TERM "$$" ;; esac', "exit 0", ""].join("\n"), { mode: 0o755 });
    writeFileSync(failLog, "");
    const uqSig = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "unquiesce"],
      { env: { ...env, ...okOutcomes, PATH: `${failBin}:${process.env.PATH}`, BASCULE_WORKDIR: uqWork }, encoding: "utf8" });
    const sl = readFileSync(failLog, "utf8");
    ok("CLI unquiesce — CronJob patch killed by a signal ⇒ exit 1, named, remaining CronJobs still patched",
      uqSig.status === 1 && /patch cronjob\/radar-refresh-pv suspend=false/.test(uqSig.stdout + uqSig.stderr) &&
      /patch cronjob radar-refresh-pending-watchdog /.test(sl) && !/cronjob\/radar-refresh-pv suspend restauré/.test(uqSig.stdout + uqSig.stderr));
    // quiesce/G2 presence lookup: only a successful empty answer means absent
    const fakeK = (lines) => { writeFileSync(join(failBin, "kubectl"), ["#!/usr/bin/env bash", `echo "$*" >> "${failLog}"`,
      'case "$*" in', ...lines, "esac", "exit 0", ""].join("\n"), { mode: 0o755 }); writeFileSync(failLog, ""); };
    const runCli = (cmd, extra = {}) => spawnSync(process.execPath, [join(DIR, "bascule.mjs"), cmd],
      { env: { ...env, PATH: `${failBin}:${process.env.PATH}`, BASCULE_WORKDIR: join(tmp, `q-${cmd}-${Math.random()}`), ...extra }, encoding: "utf8" });
    const common = ['  *"jsonpath={.spec.replicas}"*) printf 1 ;;', '  *"jsonpath={.status.replicas}"*) printf 0 ;;',
      '  *"jsonpath={.spec.suspend}"*) printf false ;;', '  *"get jobs -o json"*) printf \'{"items":[]}\' ;;'];
    fakeK(['  *"get cronjob radar-refresh-pv --ignore-not-found -o name"*) kill -TERM "$$" ;;', ...common]);
    const qSig = runCli("quiesce");
    ok("CLI quiesce — CronJob presence lookup killed by a signal ⇒ exit 1 before any scale/patch (not treated as absent)",
      qSig.status === 1 && /presence unknown/.test(qSig.stdout) && !/ scale | patch /.test(readFileSync(failLog, "utf8")));
    fakeK(['  *"get cronjob radar-refresh-pv --ignore-not-found -o name"*) exit 1 ;;', ...common]);
    eq("CLI quiesce — CronJob presence lookup failing (exit 1) ⇒ refused", runCli("quiesce").status, 1);
    fakeK(['  *"get cronjob radar-populate-geo-daily --ignore-not-found -o name"*) : ;;',
      '  *"get cronjob "*"--ignore-not-found -o name"*) printf "cronjob.batch/x" ;;', ...common]);
    const qOk = runCli("quiesce");
    const qLog = readFileSync(failLog, "utf8");
    ok("CLI quiesce — successful empty lookup = absent CronJob skipped; present ones suspended",
      qOk.status === 0 && /patch cronjob radar-refresh-pv /.test(qLog) && !/patch cronjob radar-populate-geo-daily /.test(qLog));
    // Secret rewrite: a failed annotation read refuses the replace (no metadata loss)
    fakeK(['  *"jsonpath={.metadata.labels}"*) printf "{}" ;;', '  *"jsonpath={.metadata.annotations}"*) kill -TERM "$$" ;;']);
    const annFail = runCli("docs-secret-fill", { RADAR_DOCS_SYNC_ACCESS_KEY: "0".repeat(32), RADAR_DOCS_SYNC_SECRET_KEY: "f".repeat(40) });
    ok("CLI docs-secret-fill — annotation read killed by a signal ⇒ exit 1, no replace",
      annFail.status === 1 && /annotations of Secret/.test(annFail.stdout) && !/ replace /.test(readFileSync(failLog, "utf8")));
    // G2: an unreadable current replica count refuses the restore (never read as 0)
    writeFileSync(join(failBin, "kubectl"), ["#!/usr/bin/env bash",
      'case "$*" in *"jsonpath={.status.replicas}"*) echo "$*" >> "' + failLog + '"; kill -TERM "$$" ;; esac',
      `exec "${join(bin, "kubectl")}" "$@"`, ""].join("\n"), { mode: 0o755 });
    writeFileSync(failLog, "");
    const beforeG2 = readFileSync(kubectlLog, "utf8").length;
    const g2Sig = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "restore-backup"],
      { env: { ...env, PATH: `${failBin}:${process.env.PATH}` }, encoding: "utf8" });
    ok("CLI restore-backup — G2 current replicas unreadable (signal) ⇒ refused, no rollback/restore apply",
      g2Sig.status === 1 && /status\.replicas illisible/.test(g2Sig.stdout) && !/ apply /.test(readFileSync(kubectlLog, "utf8").slice(beforeG2)));
    // quiesce: unreadable original suspend / Job list refuse (no guessed state, no skipped drain)
    fakeK(['  *"get cronjob "*"--ignore-not-found -o name"*) printf "cronjob.batch/x" ;;',
      '  *"jsonpath={.spec.suspend}"*) kill -TERM "$$" ;;', ...common.filter((l) => !/spec.suspend/.test(l))]);
    const qSus = runCli("quiesce");
    ok("CLI quiesce — original suspend unreadable ⇒ exit 1 before any scale/patch",
      qSus.status === 1 && /suspend d'origine/.test(qSus.stdout) && !/ scale | patch /.test(readFileSync(failLog, "utf8")));
    fakeK(['  *"get cronjob "*"--ignore-not-found -o name"*) printf "cronjob.batch/x" ;;',
      '  *"get jobs -o json"*) kill -TERM "$$" ;;', ...common.filter((l) => !/get jobs/.test(l))]);
    const qJobs = runCli("quiesce");
    ok("CLI quiesce — Job list unreadable ⇒ exit 1 (drain unknown, not QUIESCE OK)", qJobs.status === 1 && /drain des Jobs en vol inconnu/.test(qJobs.stdout) && !/QUIESCE OK/.test(qJobs.stdout));
    fakeK(['  *"get cronjob "*"--ignore-not-found -o name"*) printf "cronjob.batch/x" ;;',
      '  *"patch cronjob radar-refresh-pv "*) exit 1 ;;', ...common]);
    const qPatch = runCli("quiesce");
    ok("CLI quiesce — failed suspend patch ⇒ exit 1, named", qPatch.status === 1 && /patch suspend=true a échoué pour : radar-refresh-pv/.test(qPatch.stdout));
    // S1 (chain): a failed delete of the previous freshness Job still re-suspends the prod CronJob
    fakeK(['  *"delete job radar-bascule-freshness "*) exit 1 ;;']);
    const kcfg = join(tmp, "kubeconfig-prod-fake");
    writeFileSync(kcfg, "");
    const s1 = runCli("dump", { MODE: "chain", DUMP_KUBECONFIG: kcfg });
    const s1Log = readFileSync(failLog, "utf8");
    ok("CLI dump (S1) — failed delete of the previous freshness Job ⇒ no apply, prod CronJob re-suspended, exit 1",
      s1.status === 1 && !/ apply /.test(s1Log) && /suspend":false/.test(s1Log) && /suspend":true/.test(s1Log) &&
      s1Log.indexOf('suspend":false') < s1Log.indexOf('suspend":true'));
  }
  // failure-summary: reads the workdir pointers of this run (PIN of D)
  const sumFile = join(tmp, "summary.md");
  writeFileSync(sumFile, "");
  const fs1 = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "failure-summary"], { env: { ...env, GITHUB_STEP_SUMMARY: sumFile,
    O_MIGRATE: "success", O_DOCS: "failure", O_RECON: "skipped", O_FLIP: "skipped", O_UNQUIESCE: "success", O_SMOKE: "success" }, encoding: "utf8" });
  ok("CLI failure-summary — day D from the PIN, docs/flip incomplete, G1 key, written to the step summary",
    fs1.status === 0 && readFileSync(sumFile, "utf8").includes(`day D = ${D} (backup) — docs/flip INCOMPLETE`) && /DUMP_PREFIX=rollback\/preprod-rollback-/.test(readFileSync(sumFile, "utf8")));
  const h = (c) => c.repeat(32);
  const backupFill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-secrets-fill"], { env: { ...env,
    RADAR_BACKUP_READER_PREPROD_ACCESS_KEY: h("a"), RADAR_BACKUP_READER_PREPROD_SECRET_KEY: h("b"), RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY: h("c"), RADAR_BACKUP_RESTORE_DOCS_SECRET_KEY: h("d") }, encoding: "utf8" });
  const klog2 = readFileSync(kubectlLog, "utf8");
  ok("CLI backup-secrets-fill (restore) — reader-preprod + restore-docs replaced, values never in argv/stdout",
    backupFill.status === 0 && /get secret radar-backup-reader-preprod/.test(klog2) && /get secret radar-backup-restore-docs/.test(klog2) &&
    !["a", "b", "c", "d"].some((c) => klog2.includes(h(c)) || backupFill.stdout.includes(h(c))));
  const listFill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-secrets-fill"], { env: { ...env, MODE: "list",
    RADAR_BACKUP_READER_PREPROD_ACCESS_KEY: h("a"), RADAR_BACKUP_READER_PREPROD_SECRET_KEY: h("b") }, encoding: "utf8" });
  ok("CLI backup-secrets-fill (list) — reader only, copy-signer secrets not required", listFill.status === 0);
  const refs = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "served-refs"], { env: { ...env, CYCLE_ID: CLI_CYCLE }, encoding: "utf8" });
  const got = readFileSync(join(work, "served-refs", "immo-served-refs.tsv.gz"));
  eq("CLI served-refs — Job + ConfigMaps reassembled into the artefact file", [refs.status, refsFromTsv(got).zones.length], [0, 3]);
  ok("CLI served-refs — rendered Job read-only + refs writer SA", /default_transaction_read_only=on/.test(readFileSync(join(work, "radar-bascule-served-refs.rendered.yaml"), "utf8")) &&
    /serviceAccountName: radar-bascule-refs-writer/.test(readFileSync(join(work, "radar-bascule-served-refs.rendered.yaml"), "utf8")));
  const stale = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "served-refs"], { env: { ...env, CYCLE_ID: "another-cycle" }, encoding: "utf8" });
  ok("CLI served-refs — ConfigMaps of another cycle ⇒ fail-closed", stale.status === 1 && /another CYCLE_ID/.test(stale.stdout));
}

await suite();
await refsSuite();
await cliSuite();
console.log(`\nrestore-mode.selftest — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
