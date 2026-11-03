// Lot I1 — Node/TS admission sync job (cron or manual).
//
//   snapshot  — prod emitter: build + sign a FULL snapshot from the local
//               account_users and print the envelope JSON on stdout.
//               Requires ADMISSION_SIGNING_KEY. Run in prod; pipe the output
//               to the preprod ingest webhook (see runbook).
//   ingest    — preprod: read an envelope file and apply it read-only.
//               Requires ADMISSION_SYNC_ENABLED=1 + ADMISSION_PROD_PUBLIC_KEYS.
//   verify    — offline check of an envelope file against the configured
//               public keys (manual check, see runbook).
//
// Usage (inside the api container, see Make targets admission-*):
//   npx tsx src/admission/sync-job.ts snapshot
//   npx tsx src/admission/sync-job.ts ingest --file /path/envelope.json
//   npx tsx src/admission/sync-job.ts verify --file /path/envelope.json

import { readFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { resolveAdmissionConfig } from "./admission-config.js";
import { applyAdmissionSnapshot, readAdmissionSourceRows } from "./ingest.js";
import { buildAdmissionSnapshot, signSnapshot, verifySnapshot } from "./snapshot.js";

function usage(): never {
  console.error(
    "usage: sync-job.ts keygen | snapshot | ingest --file <envelope.json> | verify --file <envelope.json>",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const verb = process.argv[2];
  if (verb !== "snapshot" && verb !== "ingest" && verb !== "verify" && verb !== "keygen") usage();

  if (verb === "keygen") {
    // Owner-run key ceremony helper: prints one JSON object with
    // { kid, privateEntry, publicEntry } and creates nothing.
    const { generateAdmissionKeypair } = await import("./snapshot.js");
    process.stdout.write(`${JSON.stringify(generateAdmissionKeypair())}\n`);
    return;
  }

  const config = loadConfig();
  const admission = resolveAdmissionConfig(config);

  if (verb === "snapshot") {
    if (!admission.signingKey) {
      console.error("[admission] refused: ADMISSION_SIGNING_KEY is not configured (prod only)");
      process.exit(1);
    }
    const { db, pool } = createDb(config);
    try {
      const rows = await readAdmissionSourceRows(db);
      const payload = buildAdmissionSnapshot(rows, {
        kid: admission.signingKey.kid,
        issuedAt: new Date(),
        full: true,
      });
      const envelope = signSnapshot(payload, admission.signingKey.key);
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
    } finally {
      await pool.end();
    }
    return;
  }

  const fileFlag = process.argv[3];
  const file = process.argv[4];
  if (fileFlag !== "--file" || !file) usage();
  const raw = await readFile(file, "utf8");
  const envelope: unknown = JSON.parse(raw);

  if (verb === "verify") {
    if (admission.publicKeys.size === 0) {
      console.error("[admission] refused: ADMISSION_PROD_PUBLIC_KEYS is not configured");
      process.exit(1);
    }
    const payload = verifySnapshot(envelope, admission.publicKeys);
    process.stdout.write(
      `${JSON.stringify({ ok: true, kid: payload.kid, issuedAt: payload.issuedAt, full: payload.full, entries: payload.entries.length })}\n`,
    );
    return;
  }

  // ingest
  if (!admission.syncEnabled) {
    console.error("[admission] refused: sync is not enabled (ADMISSION_SYNC_ENABLED=1 + public keys)");
    process.exit(1);
  }
  const { db, pool } = createDb(config);
  try {
    const result = await applyAdmissionSnapshot(db, envelope, { publicKeys: admission.publicKeys });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.applied && !result.stale) process.exit(1);
  } finally {
    await pool.end();
  }
}

await main();
