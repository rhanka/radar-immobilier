  ok("workflow — served refs step after S7, CYCLE_ID + not DRY + not list", /id: served_refs\n\s+if: \$\{\{ !inputs\.DRY_RUN && env\.MODE != 'list' && env\.CYCLE_ID != '' \}\}\n\s+run: node "\$CLI" served-refs/.test(w) &&
    w.indexOf('node "$CLI" served-refs') > w.indexOf('node "$CLI" smoke'));
  ok("workflow — served-ids job consumes the immo-served-refs artefact", /name: immo-served-refs-\$\{\{ inputs\.CYCLE_ID \}\}\n\s+path: \$\{\{ runner\.temp \}\}\/served-refs/.test(w) && /IMMO_SERVED_REFS_FILE: \$\{\{ runner\.temp \}\}\/served-refs\/immo-served-refs\.tsv\.gz/.test(w));
  ok("workflow — no dependency on vars.BASCULE_IMMO_SERVED_REFS_URL", !/IMMO_SERVED_REFS_URL/.test(w));
}

// ═════════════════════════════ runner CLI end-to-end (fake kubectl) ═══════════
// The real bascule.mjs subcommands against a fake `kubectl` (bash, temp dir):
// Jobs succeed, pods carry the termination messages produced by the in-pod
// steps above. Proves the wiring R0 → S2 → S3' → S3b' → S5 (G4) and what the
// runner renders/records, with 0 cluster.
async function cliSuite() {
  const { s, manSha, dump } = fixture();
  const resolved = await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: "latest" }) });
  const docsVerdict = { ok: true, step: "docs", date: D, copied: 2, recon: { ok: true } };
  const bin = join(tmp, "fakebin");
  mkdirSync(bin, { recursive: true });
  // Every applied Job gets JOB_UID; each pod list also holds a NEWER pod of a
  // previous instance (other uid) whose verdict must never be read.
  const JOB_UID = "22222222-2222-4222-8222-222222222222";
  const podOf = (uid, ts, container, msg) => ({ metadata: { creationTimestamp: ts, ownerReferences: [{ kind: "Job", uid, controller: true }] },
    status: { initContainerStatuses: container === "fetch" ? [{ name: "fetch", state: { terminated: { message: msg } } }] : [],
      containerStatuses: container === "fetch" ? [] : [{ name: container, state: { terminated: { message: msg } } }] } });
  const pods = (container, msg) => JSON.stringify({ items: [podOf(JOB_UID, "2026-09-26T12:00:00Z", container, msg),
    podOf("99999999-9999-4999-8999-999999999999", "2026-09-26T13:00:00Z", container, '{"ok":false,"reason":"stale pod of a previous instance"}')] });
  writeFileSync(join(tmp, "pods-read.json"), pods("read", JSON.stringify(resolved.t)));
  writeFileSync(join(tmp, "pods-fetch.json"), pods("fetch", JSON.stringify({ ok: true, step: "fetch-dump", date: D })));
  writeFileSync(join(tmp, "pods-docs.json"), pods("docs", JSON.stringify(docsVerdict)));
  // what the served-refs Job would have published for this CYCLE_ID
  const CLI_CYCLE = "iso-prod-2026-09-27-cli";
  const refsPuts = [];
  await sr.run({ env: { CYCLE_ID: CLI_CYCLE, POD_NAMESPACE: "radar-immobilier-preprod", KUBE_TOKEN_DIR: "/tok" },
    readFile: (p) => ({ "/work/refs.tsv": REFS_TSV, "/work/sources.tsv": "", "/tok/token": "t", "/tok/ca.crt": "c" })[p] ?? "",
    put: async (a) => { refsPuts.push(a); return 200; }, log: () => {} });
  writeFileSync(join(tmp, "cm-refs-0.json"), JSON.stringify(refsPuts[0].body));
  const kubectlLog = join(tmp, "kubectl.log");
  writeFileSync(join(bin, "kubectl"), [
    "#!/usr/bin/env bash",
    `echo "$*" >> "${kubectlLog}"`,
    'case "$*" in',
    '  *"containers[0].image"*) printf "ghcr.io/rhanka/radar-api@sha256:%064d" 0 ;;',
    '  *"jsonpath={.spec.replicas}"*|*"jsonpath={.status.replicas}"*) printf 0 ;;',
    '  *"jsonpath={.spec.suspend}"*) printf true ;;',
    '  *"get cronjob"*"-o name"*) printf "cronjob/x" ;;',
    '  *"get jobs -o json"*) printf \'{"items":[]}\' ;;',
    '  *"get job "*"jsonpath={.status}"*) printf \'{"succeeded":1}\' ;;',
    `  *"get job "*"jsonpath={.metadata.uid}"*) printf "${JOB_UID}" ;;`,
    `  *"job-name=${JOBS.resolve}"*) cat "${join(tmp, "pods-read.json")}" ;;`,
    `  *"job-name=${JOBS.db}"*) cat "${join(tmp, "pods-fetch.json")}" ;;`,
    `  *"job-name=${JOBS.docs}"*|*"job-name=${JOBS.recon}"*) cat "${join(tmp, "pods-docs.json")}" ;;`,
    `  *"get configmap immo-served-refs-0 -o json"*) cat "${join(tmp, "cm-refs-0.json")}" ;;`,
    '  *"get configmap immo-served-refs-"*) printf \'{"data":{}}\' ;;',
    "  *) : ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });
  const work = join(tmp, "cli-work");
  const out = join(tmp, "gh-output");
  writeFileSync(out, "");
  const env = {
    PATH: `${bin}:${process.env.PATH}`, MODE: "restore", BACKUP_ID: "latest", BHS: "s3.bhs.io.cloud.ovh.net", S3_REGION: "bhs",
    EXPECTED_DATABASE: "radar", PREPROD_DOCS: DST, PROD_DOCS: PROD, DUMP_BUCKET: "radar-immobilier-backups-preprod",
    CONFIRM: `iso-prod-${new Date().toISOString().slice(0, 10)}`, CONFIRM_EXPECTED: `iso-prod-${new Date().toISOString().slice(0, 10)}`,
    BASCULE_WORKDIR: work, GITHUB_OUTPUT: out, DOCS_SYNC_GRANTEE: "1901410700457444:user-x", QUIESCE_TIMEOUT: "5",
  };
  const cli = (cmd) => spawnSync(process.execPath, [join(DIR, "bascule.mjs"), cmd], { env, encoding: "utf8" });
  const pre = cli("preflight-backup");
  eq("CLI preflight-backup — exit 0", pre.status, 0);
  const r0 = cli("backup-resolve");
  eq("CLI backup-resolve — exit 0", r0.status, 0);
  const pin = JSON.parse(readFileSync(join(work, "backup-pin.json"), "utf8"));
  eq("CLI backup-resolve — backup-pin.json pinned", [pin.date, pin.manifestSha256 === manSha, pin.pgSha256 === sha(dump)], [D, true, true]);
  ok("CLI backup-resolve — GITHUB_OUTPUT backup_date", readFileSync(out, "utf8").includes(`backup_date=${D}\n`));
  const rr = readFileSync(join(work, `${JOBS.resolve}.rendered.yaml`), "utf8");
  ok("CLI backup-resolve — rendered Job carries BACKUP_ID + reader Secret, no leftover", /BACKUP_ID, value: "latest"/.test(rr) && /name: radar-backup-reader-preprod, key: S3_ACCESS_KEY/.test(rr) && !/\$\{[A-Z0-9_]+\}/.test(rr));
  if (YAML) ok("CLI backup-resolve — rendered Job is valid YAML", YAML.parse(rr).kind === "Job");
  const s2 = cli("restore-backup");
  eq("CLI restore-backup — exit 0 (G2 + G1 + Job)", s2.status, 0);
  const rd = readFileSync(join(work, `${JOBS.db}.rendered.yaml`), "utf8");
  ok("CLI restore-backup — Job pinned to D + manifest/dump sha256", rd.includes(`value: "${D}"`) && rd.includes(manSha) && rd.includes(sha(dump)));
  ok("CLI restore-backup — G1 rollback Job dispatched before the restore", (() => { const l = readFileSync(kubectlLog, "utf8"); return l.indexOf("radar-db-rollback-bascule") > -1 && l.indexOf("radar-db-rollback-bascule") < l.indexOf(JOBS.db); })());
  ok("CLI restore-backup — never a live dump / PROD kubeconfig", !/radar-db-backup-prod|--kubeconfig/.test(readFileSync(kubectlLog, "utf8")));
  eq("CLI docs-restore — exit 0", cli("docs-restore").status, 0);
  const rdoc = readFileSync(join(work, `${JOBS.docs}.rendered.yaml`), "utf8");
  ok("CLI docs-restore — prod docs + backup bucket forbidden, preprod target, grant", rdoc.includes(`FORBIDDEN_DST_BUCKETS, value: "${PROD},${B}"`) && rdoc.includes(`DST_BUCKET, value: "${DST}"`) && rdoc.includes("user-x"));
  const noProd = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "preflight-backup"], { env: { ...env, PROD_DOCS: "" }, encoding: "utf8" });
  ok("CLI preflight-backup (restore) — PROD_DOCS absent ⇒ refused", noProd.status === 1 && /PROD_DOCS/.test(noProd.stdout));
  const intoProd = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "preflight-backup"], { env: { ...env, PROD_DOCS: "some-other-prod", PREPROD_DOCS: PROD }, encoding: "utf8" });
  ok("CLI preflight-backup (restore) — PREPROD_DOCS = frozen prod docs bucket ⇒ refused", intoProd.status === 1 && /forbidden destination/.test(intoProd.stdout));
  eq("CLI recon-backup — exit 0 + sentinel", [cli("recon-backup").status, JSON.parse(readFileSync(join(work, "recon.ok.json"), "utf8")).backupDate], [0, D]);
  const flip = cli("flip");
  eq("CLI flip — G4 = recon vs inventory(D) re-run, exit 0", flip.status, 0);
  ok("CLI flip — set env issued after the recon re-run", /set env deploy\/radar-api GEO_DOCUMENTS_REPOINT-/.test(readFileSync(kubectlLog, "utf8")));
  const bad = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-resolve"], { env: { ...env, BACKUP_ID: "2026-99-01" }, encoding: "utf8" });
  ok("CLI backup-resolve — malformed BACKUP_ID refused before any kubectl", bad.status === 1 && /BACKUP_ID must be/.test(bad.stdout));
  const wrongMode = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "restore-backup"], { env: { ...env, MODE: "chain" }, encoding: "utf8" });
  eq("CLI restore-backup — refused in MODE=chain", wrongMode.status, 1);
  const secretFill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "docs-secret-fill"], { env: { ...env, RADAR_DOCS_SYNC_ACCESS_KEY: "0".repeat(32), RADAR_DOCS_SYNC_SECRET_KEY: "f".repeat(40) }, encoding: "utf8" });
  const klog = readFileSync(kubectlLog, "utf8");
  ok("CLI docs-secret-fill — dry-run=server then replace, values never in argv/stdout",
    secretFill.status === 0 && /replace --dry-run=server -f \S+ -o name/.test(klog) && /replace -f \S+ -o name/.test(klog) &&
    !klog.includes("f".repeat(40)) && !secretFill.stdout.includes("f".repeat(40)));
  const noSecret = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "docs-secret-fill"], { env, encoding: "utf8" });
  ok("CLI docs-secret-fill — GitHub secret absent ⇒ fail-closed", noSecret.status === 1 && /missing or malformed/.test(noSecret.stdout));
  const before = readFileSync(kubectlLog, "utf8").length;
  const check = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "docs-secret-fill", "--check"], { env: { ...env, RADAR_DOCS_SYNC_ACCESS_KEY: "0".repeat(32), RADAR_DOCS_SYNC_SECRET_KEY: "f".repeat(40) }, encoding: "utf8" });
  const klogCheck = readFileSync(kubectlLog, "utf8").slice(before);
  ok("CLI docs-secret-fill --check (DRY) — server dry-run only, no write", check.status === 0 && /replace --dry-run=server -f/.test(klogCheck) && !/replace -f/.test(klogCheck));
  // G3 in every MODE, before any Secret write or Job (list included)
  const g3env = { ...env, CONFIRM: "iso-prod-2020-01-01" };
  const beforeG3 = readFileSync(kubectlLog, "utf8").length;
  const g3list = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "preflight-backup"], { env: { ...g3env, MODE: "list" }, encoding: "utf8" });
  const g3fill = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-secrets-fill"], { env: { ...g3env, MODE: "list",
    RADAR_BACKUP_READER_PREPROD_ACCESS_KEY: "a".repeat(32), RADAR_BACKUP_READER_PREPROD_SECRET_KEY: "b".repeat(32) }, encoding: "utf8" });
  const g3job = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "backup-list"], { env: { ...g3env, MODE: "list" }, encoding: "utf8" });
  const g3cmd = spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "confirm"], { env: g3env, encoding: "utf8" });
  ok("CLI G3 — stale CONFIRM refused in MODE=list: preflight, Secret write, Job, confirm step — 0 kubectl call",
    [g3list, g3fill, g3job, g3cmd].every((r) => r.status === 1 && /GARDE G3/.test(r.stdout)) && readFileSync(kubectlLog, "utf8").length === beforeG3);
  eq("CLI confirm — today's CONFIRM accepted", spawnSync(process.execPath, [join(DIR, "bascule.mjs"), "confirm"], { env, encoding: "utf8" }).status, 0);
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
