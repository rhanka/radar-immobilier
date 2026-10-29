    });
    if (!res.ok) failWithVerdict(res, ns, JOBS.resolve, "read", "R0 backup refused");
    const { verdict, readable } = readVerdict(ns, JOBS.resolve, "read", res.uid);
    if (!verdict) {
      die(readable ? "R0 — resolve Job succeeded but wrote no PIN (termination message missing)."
        : "R0 — the CI cannot read the resolve pod status (RBAC get/list pods in the preprod namespace is required for MODE=restore — see README).");
    }
    let pin;
    try { pin = validatePin(verdict); } catch (e) { die(e.message); }
    writeFileSync(join(workdir(), PIN_FILE), `${JSON.stringify(pin, null, 2)}\n`, { mode: 0o600 });
    if (pin.stale && backupId !== "latest") warn(`backup ${pin.date} is ${pin.ageHours} h old — explicit BACKUP_ID, age not blocking.`);
    if (pin.staleOverridden) warn(`latest backup ${pin.date} is ${pin.ageHours} h old — accepted by ALLOW_STALE_BACKUP=true.`);
    log(`R0 OK — BACKUP_ID=${pin.backupId} → date=${pin.date} (complete) age=${pin.ageHours} h pg=${pin.pgSizeBytes} bytes ` +
      `pg.sha256=${pin.pgSha256} manifest.sha256=${pin.manifestSha256} docs=${pin.docsObjects} migrations=${pin.migrations}` +
      `${pin.lastTag ? ` (${pin.lastTag})` : ""} code=${pin.codeSha ?? "unknown"}`);
    writeOutputs([["backup_id", pin.backupId], ["backup_date", pin.date], ["manifest_sha256", pin.manifestSha256],
      ["pg_sha256", pin.pgSha256], ["dump_started_at", pin.dumpStartedAt]]);
    summary(`### Backup resolved\n\n| BACKUP_ID | date | age (h) | pg dump | pg sha256 | manifest sha256 | docs | migrations |\n` +
      `|---|---|---|---|---|---|---|---|\n| ${pin.backupId} | ${pin.date} | ${pin.ageHours} | ${pin.pgSizeBytes} | ${pin.pgSha256} | ` +
      `${pin.manifestSha256} | ${pin.docsObjects ?? "-"} | ${pin.migrations ?? "-"} |`);
  }

  // ── list (read-only) ────────────────────────────────────────────────────────
  function cmdBackupList() {
    section("backup-list — Job read-only (backups available)");
    if (mode() !== "list") die("backup-list requires MODE=list.");
    assertConfirm(); // G3 before the (read-only) Job, list included
    const bp = backupParams();
    const ns = bp.jd.NAMESPACE;
    const res = dispatch({
      tmpl: "backup-read-job.tmpl.yaml",
      jobName: JOBS.list,
      vars: {
        JOB_NAME: JOBS.list, NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), BR_STEP: "list",
        READER_SECRET: bp.readerSecret, S3_ENDPOINT: bp.jd.S3_ENDPOINT, S3_REGION: bp.jd.S3_REGION,
        S3_FORCE_PATH_STYLE: bp.forcePathStyle, EXPECTED_BACKUP_BUCKET: bp.bucket, BACKUP_ID: "latest",
        ALLOW_STALE_BACKUP: "false", MAX_AGE_HOURS: bp.maxAgeHours, TTL_SECONDS: bp.jd.TTL_SECONDS,
      },
      timeoutSec: Number(opt("BACKUP_LIST_TIMEOUT", "600")),
    });
    if (!res.ok) failWithVerdict(res, ns, JOBS.list, "read", "backup-list failed");
    const { verdict, readable } = readVerdict(ns, JOBS.list, "read", res.uid);
    if (!verdict) die(readable ? "backup-list wrote no verdict." : "the CI cannot read the list pod status (RBAC get/list pods — see README).");
    let listing;
    try { listing = validateListing(verdict); } catch (e) { die(e.message); }
    writeFileSync(join(workdir(), LIST_FILE), `${JSON.stringify(listing, null, 2)}\n`, { mode: 0o644 });
    const t = formatBackupTable(listing);
    log(`backups in ${listing.bucket}: ${listing.count} (latest=${listing.latest}, latest complete=${listing.latestComplete}; * = latest complete)` +
      `${listing.truncated ? " — list truncated to the newest entries" : ""}\n${t.text}`);
    summary(`### Backups available — ${listing.bucket}\n\nlatest = ${listing.latest} · latest complete (*) = ${listing.latestComplete}` +
      `${listing.truncated ? " · truncated to the newest entries" : ""}\n\n${t.md}`);
  }

  // ── S2 restore from pg/<D>/radar.dump ───────────────────────────────────────
  function cmdRestoreBackup() {
    section("S2 restore préprod FROM the backup (G2 quiesce + G1 rollback + Job restore-backup)");
    assertConfirm(); // G3
    if (mode() !== "restore") die("restore-backup requires MODE=restore.");
    const pin = loadPin();
    const bp = backupParams();
    assertQuiesced(); // G2
    runRollbackG1(); // G1 (same Job as the chain mode)
    const ns = bp.jd.NAMESPACE;
    const res = dispatch({
      tmpl: "db-restore-backup-job.tmpl.yaml",
      jobName: JOBS.db,
      vars: {
        NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), DUMP_IMAGE: bp.jd.DUMP_IMAGE, READER_SECRET: bp.readerSecret,
        S3_ENDPOINT: bp.jd.S3_ENDPOINT, S3_REGION: bp.jd.S3_REGION, S3_FORCE_PATH_STYLE: bp.forcePathStyle,
        EXPECTED_BACKUP_BUCKET: bp.bucket, BACKUP_DATE: pin.date, PIN_MANIFEST_SHA256: pin.manifestSha256,
        PIN_PG_SHA256: pin.pgSha256, DB_SECRET: bp.jd.DB_SECRET, PGHOST: bp.jd.PGHOST,
        EXPECTED_DATABASE: req("EXPECTED_DATABASE"), RESTORE_ASSERT_DB: opt("RESTORE_ASSERT_DB", "1") !== "0" ? "1" : "0",
        TTL_SECONDS: bp.jd.TTL_SECONDS,
      },
      timeoutSec: Number(opt("RESTORE_TIMEOUT", "1800")),
    });
    if (!res.ok) failWithVerdict(res, ns, JOBS.db, "fetch", "S2 restore-backup failed (fetch verdict shown when the fetch step refused)");
    log(`S2 OK — backup ${pin.date} restored into preprod (sha256 ${pin.pgSha256} verified in-cluster, G1 rollback durable).`);
  }

  function docsJob({ step, dry }) {
    const pin = loadPin();
    const bp = backupParams();
    const ns = bp.jd.NAMESPACE;
    const dst = req("PREPROD_DOCS");
    let forbidden;
    try { forbidden = forbiddenDstBuckets({ prodDocs: opt("PROD_DOCS", ""), extra: opt("BACKUP_FORBIDDEN_DST_BUCKETS", ""), backupBucket: bp.bucket }); } catch (e) { die(e.message); }
    if (forbidden.split(",").includes(dst)) die(`PREPROD_DOCS (${dst}) is a forbidden destination (production docs or backup bucket).`);
    const jobName = step === "docs" ? JOBS.docs : JOBS.recon;
    const res = dispatch({
      tmpl: "docs-restore-backup-job.tmpl.yaml",
      jobName,
      vars: {
        JOB_NAME: jobName, NAMESPACE: ns, IMAGE: resolvePreprodImage(ns), BR_STEP: step,
        READER_SECRET: bp.readerSecret, COPY_SECRET: bp.copySecret, S3_ENDPOINT: bp.jd.S3_ENDPOINT,
        S3_REGION: bp.jd.S3_REGION, S3_FORCE_PATH_STYLE: bp.forcePathStyle, EXPECTED_BACKUP_BUCKET: bp.bucket,
        BACKUP_DATE: pin.date, PIN_MANIFEST_SHA256: pin.manifestSha256, DST_BUCKET: dst,
        FORBIDDEN_DST_BUCKETS: forbidden, COPY_GRANTEE: opt("DOCS_SYNC_GRANTEE", ""),
        COPY_CONCURRENCY: String(Math.max(1, Math.min(32, Number(opt("BACKUP_COPY_CONCURRENCY", "8")) || 8))),
        DOCS_DRY: dry ? "1" : "0", TTL_SECONDS: bp.jd.TTL_SECONDS,
      },
      timeoutSec: Number(opt(step === "docs" ? "DOCS_RESTORE_TIMEOUT" : "RECON_TIMEOUT", step === "docs" ? "7500" : "900")),
    });
    const { verdict } = readVerdict(ns, jobName, "docs", res.uid);
    return { res, verdict, pin, dst, ns, jobName };
  }

  const countsLine = (v) => (v ? Object.entries(v).filter(([k]) => !["ok", "step", "reason"].includes(k))
    .map(([k, x]) => `${k}=${typeof x === "object" ? JSON.stringify(x) : x}`).join(" ").slice(0, 600) : "no verdict readable");

  // ── S3' docs state at D ─────────────────────────────────────────────────────
  function cmdDocsRestore() {
    const dry = opt("DRY", "") === "1" || process.argv.includes("--dry");
    section(`S3' docs-restore FROM the backup (${dry ? "DRY: plan only, 0 copy" : "server-side CopyObject, additive"})`);
    if (mode() !== "restore") die("docs-restore requires MODE=restore.");
    if (!dry) assertConfirm(); // G3 for the real copy
    const { res, verdict, pin, ns, jobName } = docsJob({ step: "docs", dry });
    if (!res.ok) failWithVerdict(res, ns, jobName, "docs", `S3' docs-restore ${dry ? "plan " : ""}failed [${countsLine(verdict)}]`);
    log(`S3' ${dry ? "DRY " : ""}OK — docs state of ${pin.date} ${dry ? "restorable" : "restored"} [${countsLine(verdict)}]`);
  }

  // ── S3b' recon dest ⊇ inventory(D) + sentinel for G4 ────────────────────────
  function cmdReconBackup() {
    section("S3b' recon-backup — preprod docs ⊇ docs-inventory(D) (Key + Size, Job verdict)");
    if (mode() !== "restore") die("recon-backup requires MODE=restore.");
    const { res, verdict, pin, dst, ns, jobName } = docsJob({ step: "recon", dry: false });
    if (!res.ok) failWithVerdict(res, ns, jobName, "docs", `S3b' recon-backup failed [${countsLine(verdict)}]`);
    const sentinel = { ok: true, mode: "restore", backupDate: pin.date, manifestSha256: pin.manifestSha256, preprod: dst, at: new Date().toISOString() };
    writeFileSync(join(workdir(), "recon.ok.json"), `${JSON.stringify(sentinel)}\n`, { mode: 0o600 });
    log(`S3b' OK — preprod docs ⊇ inventory of ${pin.date} [${countsLine(verdict)}]. Sentinel recon.ok written.`);
  }

  // G4 of the flip in MODE=restore: sentinel of THIS backup + recon re-run.
  function assertReconOk() {
    const p = join(workdir(), "recon.ok.json");
    if (!existsSync(p)) die("GARDE G4 — recon.ok sentinel absent: run recon-backup (S3b') and get it GREEN before the flip.");
    let s;
    try { s = JSON.parse(readFileSync(p, "utf8")); } catch { die("GARDE G4 — recon.ok sentinel unreadable."); }
    const pin = loadPin();
    if (!s.ok || s.mode !== "restore" || s.backupDate !== pin.date || s.manifestSha256 !== pin.manifestSha256 || s.preprod !== req("PREPROD_DOCS")) {
      die("GARDE G4 — recon.ok sentinel does not match the current backup/bucket: re-run recon-backup.");
    }
    cmdReconBackup();
    log("GARDE G4 OK — recon vs inventory(D) re-confirmed (Job) right before the flip.");
  }

  return {
    assertReconOk,
    commands: {
      "preflight-backup": cmdPreflightBackup,
      "backup-resolve": cmdBackupResolve,
      "backup-list": cmdBackupList,
      "restore-backup": cmdRestoreBackup,
      "docs-restore": cmdDocsRestore,
      "recon-backup": cmdReconBackup,
    },
  };
}
