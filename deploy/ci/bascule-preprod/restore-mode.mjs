
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
