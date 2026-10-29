  ];
  const DST5 = [
    o("normalized/a", 10, '"e1"', T0),
    o("normalized/b", 20, '"md5-b"', T1),
    o("normalized/c", 31, '"e3"', T1),
    o("normalized/d", 40, '"md5-d"', T0),
    o("normalized/x-preprod", 7, '"px"', T0), // extra préprod ignoré
  ];
  const keys = (r) => r.copies.map((c) => c.Key).sort();

  const r1 = await runSync({ srcObjs: SRC5, dstObjs: DST5 });
  eq("docs-sync — exit 0", r1.code, 0);
  eq("docs-sync — copie SEULEMENT absentes/différentes (pagination src+dst)", keys(r1), ["normalized/c", "normalized/d", "normalized/e f"]);
  ok("docs-sync — CopySource encodé + GrantFullControl + même clé", r1.copies.some((c) => c.CopySource === "/src/normalized/e%20f" && c.GrantFullControl === "id=g1" && c.Bucket === "dst"));
  ok("docs-sync — compte rendu source/deja_a_jour/a_copier", r1.logs.some((l) => /source=5 deja_a_jour=2 a_copier=3 concurrence=8/.test(l)));

  const r2 = await runSync({ srcObjs: SRC5, dstObjs: SRC5 });
  eq("docs-sync — préprod déjà complète ⇒ 0 copie, exit 0", [r2.code, r2.copies.length], [0, 0]);

  const r3 = await runSync({ srcObjs: SRC5, dstObjs: DST5, dstListFails: true });
  eq("docs-sync — LIST destination refusée ⇒ repli copie complète", [r3.code, r3.copies.length], [0, 5]);
  ok("docs-sync — repli signalé en WARN", r3.logs.some((l) => /LIST destination impossible \(AccessDenied\)/.test(l)));

  const MANY = Array.from({ length: 40 }, (_, k) => o(`normalized/k${k}`, k + 1, `"e${k}"`, T0));
  const r4 = await runSync({ srcObjs: MANY, dstObjs: [], concurrency: 4, pageSize: 7 });
  eq("docs-sync — 40 absentes ⇒ 40 copies", [r4.code, r4.copies.length], [0, 40]);
  ok(`docs-sync — concurrence bornée à COPY_CONCURRENCY=4 et effective (max ${r4.maxInFlight})`, r4.maxInFlight === 4);

  const r5 = await runSync({ srcObjs: MANY, dstObjs: [], concurrency: 999 });
  ok(`docs-sync — COPY_CONCURRENCY plafonnée à 32 (max ${r5.maxInFlight})`, r5.maxInFlight <= 32 && r5.maxInFlight > 1);

  const r6 = await runSync({ srcObjs: MANY, dstObjs: [], failCopyKey: "normalized/k7" });
  eq("docs-sync — erreur de copie ⇒ exit 1 (fail-closed)", r6.code, 1);

  // ÉCART immo (volontaire, cf. header docs-sync-job.tmpl.yaml) : source vide ⇒
  // « rien à copier », exit 0 (geo : exit 1, un normalized/ prod vide = panne).
  const r7 = await runSync({ srcObjs: [], dstObjs: DST5 });
  eq("docs-sync — source vide ⇒ « rien à copier », exit 0 (écart immo, inchangé)", [r7.code, r7.copies.length], [0, 0]);
}

// ── Scheduled run cadence: DAILY, 04:00 UTC on the hour (owner request 2026-10-10,
// "restore daily"; weekly Sunday 03:17 UTC from 2026-09-26 to 2026-10-10) ──
{
  const wf = readFileSync(join(import.meta.dirname, "../../../.github/workflows/bascule-preprod.yml"), "utf8");
  // Every active `- cron:` entry, whatever its quoting (comment lines ignored).
  const crons = wf.split("\n").filter((x) => !/^\s*#/.test(x)).map((x) => x.match(/^\s*-\s*cron:\s*(.*)$/)).filter(Boolean)
    .map((m) => m[1].replace(/^'([^']*)'.*$/, "$1").replace(/^"([^"]*)".*$/, "$1").replace(/\s+#.*$/, "").trim());
  eq("bascule-preprod.yml — a single cron, daily 04:00 UTC on the hour", crons, ["0 4 * * *"]);
  // The RELATIONAL window guard (restore after the daily backup, clear of every
  // RENDERED refresh start) lives in deploy/k8s/refresh-cronjobs/bascule-window.awk,
  // run by `refresh-018.mk verify-renders` (CI) on the prod and preprod renders.
  ok("bascule-preprod.yml — run planifié armé par vars.BASCULE_SCHEDULE_ENABLED (inchangé)",
    wf.includes("github.event_name != 'schedule' || vars.BASCULE_SCHEDULE_ENABLED == 'true'"));
  // A scheduled run = MODE=restore from the LATEST complete backup, 24 h guard active.
  ok("schedule ⇒ MODE=restore (dispatch keeps its input, default chain)",
    wf.includes("MODE: ${{ github.event_name == 'schedule' && 'restore' || inputs.MODE || 'chain' }}"));
  ok("schedule ⇒ BACKUP_ID latest (= latestComplete), ALLOW_STALE_BACKUP forced false (24 h guard active)",
    wf.includes("BACKUP_ID: ${{ inputs.BACKUP_ID || 'latest' }}") &&
    wf.includes("ALLOW_STALE_BACKUP: ${{ github.event_name != 'schedule' && inputs.ALLOW_STALE_BACKUP && 'true' || 'false' }}"));
  ok("schedule ⇒ auto-CONFIRM of the day kept", /if \[ "\$EVENT_NAME" = "schedule" \]; then\n\s+echo "CONFIRM=\$\{today\}" >> "\$GITHUB_ENV"/.test(wf));
  ok("schedule ⇒ restore budget (330 min) and run-name 'restore'", wf.includes("timeout-minutes: ${{ (github.event_name == 'schedule' || inputs.MODE == 'restore') && 330 || 180 }}") &&
    wf.includes("run-name: \"bascule-preprod ${{ github.event_name == 'schedule' && 'restore' || inputs.MODE || 'chain' }}"));
}
// ── NO refresh in the bascule (owner decision: "a restore is a restore") ──────
{
  const wf = readFileSync(join(import.meta.dirname, "../../../.github/workflows/bascule-preprod.yml"), "utf8");
  const active = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  ok("bascule-preprod.yml — no refresh step, no force-refresh job", !/node "\$CLI" (refresh|force-refresh|precheck-runs)\s*$/m.test(active) && !/\n {2}force-refresh:\n/.test(wf));
  ok("bascule-preprod.yml — no SKIP_REFRESH / FORCE_REFRESH / REFRESH_* input or env", !/SKIP_REFRESH|FORCE_REFRESH|REFRESH_(CHUNK|CITIES|CONCURRENCY|CRONJOB)/.test(active));
  ok("bascule-preprod.yml — advisory precheck-runs --prod kept (information only, chain)", active.includes('node "$CLI" precheck-runs --prod'));
  let tmplGone = false;
  try { readFileSync(join(import.meta.dirname, "refresh-job.tmpl.yaml"), "utf8"); } catch { tmplGone = true; }
  ok("refresh-job.tmpl.yaml removed (the refresh Job of S6 no longer exists)", tmplGone);
  const cli = readFileSync(join(import.meta.dirname, "bascule.mjs"), "utf8");
  ok("bascule.mjs — no `refresh` subcommand, force-refresh kept for bascule-refresh.yml", !/\n\s+refresh: cmdRefresh,/.test(cli) && !/function cmdRefresh\b/.test(cli) &&
    /"force-refresh": cmdForceRefresh/.test(cli));
  const standalone = readFileSync(join(import.meta.dirname, "../../../.github/workflows/bascule-refresh.yml"), "utf8");
  ok("bascule-refresh.yml — the on-demand refresh stays OUTSIDE the bascule", standalone.includes('node "$CLI" force-refresh'));
}

// Exercise the real unquiesce command offline: every external call is captured.
{
  const cli = readFileSync(join(import.meta.dirname, "bascule.mjs"), "utf8");
  const start = cli.indexOf("// UN-QUIESCE —");
  const command = cli.slice(start, cli.indexOf("// S2 —", start)).replace(/^export /gm, "");
  function unquiesce(env, recorded = true) {
    const calls = [];
    let error = null;
    try {
      vm.runInNewContext(`${command}\ncmdUnquiesce();`, {
        quiesceTargets: () => ({ ns: "test-preprod" }), workdir: () => "/test", join,
        existsSync: () => recorded,
        readFileSync: () => JSON.stringify({ deployments: { "radar-api": 2 }, cronjobs: { refresh: false } }),
        opt: (key, fallback) => env[key] || fallback,
        log: () => {}, warn: () => {}, section: () => {},
        die: (message) => { throw new Error(message); },
        process: { exit: (code) => { throw new Error(`exit ${code}`); } },
        run: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; },
      });
    } catch (e) { error = e.message; }
    return { calls, error };
  }
  const success = { O_MIGRATE: "success", O_RESTORE: "success", O_DOCS: "success", O_RECON: "success" };
  for (const key of ["O_MIGRATE", "O_RESTORE", "O_DOCS"]) {
    for (const outcome of ["failure", "cancelled", "skipped", ""]) {
      const r = unquiesce({ ...success, [key]: outcome });
      ok(`unquiesce — ${key}=${outcome || "missing"} keeps preprod closed`, r.calls.length === 0 && /preprod stays closed/.test(r.error));
    }
  }
  const missing = unquiesce({});
  ok("unquiesce — all outcomes missing keeps preprod closed", missing.calls.length === 0 && /preprod stays closed/.test(missing.error));
  eq("unquiesce — failure before quiesce changes nothing", unquiesce({ O_MIGRATE: "failure" }, false), { calls: [], error: null });
  const resumed = unquiesce(success);
  eq("unquiesce — successful restore resumes deployments and cronjobs", resumed, { calls: [
    ["kubectl", "-n", "test-preprod", "scale", "deploy/radar-api", "--replicas=2"],
    ["kubectl", "-n", "test-preprod", "rollout", "status", "deploy/radar-api", "--timeout=300s"],
    ["kubectl", "-n", "test-preprod", "patch", "cronjob", "refresh", "-p", '{"spec":{"suspend":false}}'],
  ], error: null });
  const wf = readFileSync(join(import.meta.dirname, "../../../.github/workflows/bascule-preprod.yml"), "utf8");
  const step = wf.slice(wf.indexOf("id: unquiesce"), wf.indexOf('run: node "$CLI" unquiesce'));
  for (const key of ["O_MIGRATE", "O_RESTORE", "O_DOCS"]) {
    ok(`unquiesce workflow forwards ${key}`, step.includes(`${key}:`));
  }
}

console.log(`\nbascule.selftest — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
