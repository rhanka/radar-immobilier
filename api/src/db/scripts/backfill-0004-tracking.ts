#!/usr/bin/env tsx
/**
 * Backfill idempotent — tracking drizzle de la migration 0004_auth_users
 *
 * CONTEXTE
 * --------
 * La migration `api/drizzle/0004_auth_users.sql` (table account_users) a été
 * appliquée MANUELLEMENT en prod. La table `drizzle.__drizzle_migrations`
 * ne contenait PAS la ligne correspondante. Conséquence : `npm run db:migrate`
 * aurait tenté de rejouer 0004 et échoué (table account_users déjà existante).
 *
 * CE QUE CE SCRIPT FAIT
 * ---------------------
 * 1. Vérifie si la ligne de tracking 0004 est déjà présente (hash check).
 * 2. Si absente → insère la ligne (hash + created_at) dans drizzle.__drizzle_migrations.
 * 3. Si déjà présente → no-op (idempotent, ré-exécutable sans dégât).
 *
 * RUNBOOK PROD
 * ------------
 * Prérequis : variables POSTGRES_* (ou env de prod via docker/k8s).
 * NE PAS EXÉCUTER sans avoir validé en staging d'abord.
 *
 *   # 1. Vérifier l'état actuel (doit retourner 4 lignes pour 0000..0003)
 *   psql -h $POSTGRES_HOST -U $POSTGRES_USER $POSTGRES_DB \
 *     -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"
 *
 *   # 2. Exécuter le backfill (idempotent)
 *   cd api && npx tsx src/db/scripts/backfill-0004-tracking.ts
 *
 *   # 3. Vérifier le résultat (doit afficher 5 lignes : 0000..0004)
 *   psql -h $POSTGRES_HOST -U $POSTGRES_USER $POSTGRES_DB \
 *     -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"
 *
 *   # 4. Tester que db:migrate ne rejoue plus 0004
 *   cd api && npm run db:migrate
 *   # Attendu : "migrations applied" (sans erreur ni re-jeu de 0004)
 *
 * COMMENT EST CALCULÉ LE HASH
 * ---------------------------
 * Drizzle calcule : SHA256(contenu_text_du_fichier_sql).digest('hex')
 * Ref : node_modules/drizzle-orm/migrator.js ligne 34
 * Hash 0004 : sha256sum api/drizzle/0004_auth_users.sql
 *   → 169af5eddba46982e4bddc760c4f4e1a57846393fb6f40268d24411999b5c96b
 *
 * LE created_at (BIGINT)
 * ----------------------
 * Drizzle stocke `folderMillis` = champ `when` du _journal.json (ms epoch).
 * On utilise 1749870000000 (2025-06-14 01:00:00 UTC), postérieur à 0003
 * (1749783600000 = 2025-06-13), cohérent avec l'entrée ajoutée dans le journal.
 */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Paramètres de la migration 0004 ─────────────────────────────────────────
const SQL_PATH = resolve(__dirname, "../../../drizzle/0004_auth_users.sql");
const MIGRATION_WHEN = 1749870000000; // 2025-06-14 01:00 UTC (bigint en DB)

// Hash calculé comme drizzle : SHA256 du contenu texte du fichier
const sqlContent = readFileSync(SQL_PATH, "utf-8");
const MIGRATION_HASH = crypto.createHash("sha256").update(sqlContent).digest("hex");

const MIGRATIONS_SCHEMA = "drizzle"; // schema drizzle-orm par défaut
const MIGRATIONS_TABLE = "__drizzle_migrations";

// ── Connexion via config standard du projet ──────────────────────────────────
const config = loadConfig();
const pool = new pg.Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DB,
});

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    // Vérifier si la ligne existe déjà (idempotent)
    const existing = await client.query<{ hash: string }>(
      `SELECT hash FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} WHERE hash = $1`,
      [MIGRATION_HASH],
    );

    if (existing.rowCount !== null && existing.rowCount > 0) {
      console.log(`[backfill-0004] Ligne déjà présente (hash=${MIGRATION_HASH.slice(0, 16)}…) — rien à faire.`);
      return;
    }

    // Insérer la ligne de tracking
    await client.query(
      `INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at) VALUES ($1, $2)`,
      [MIGRATION_HASH, MIGRATION_WHEN],
    );

    console.log(`[backfill-0004] Ligne insérée avec succès :`);
    console.log(`  hash       = ${MIGRATION_HASH}`);
    console.log(`  created_at = ${String(MIGRATION_WHEN)} (${new Date(MIGRATION_WHEN).toISOString()})`);
    console.log(`[backfill-0004] Vérifier : SELECT * FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} ORDER BY created_at;`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err: unknown) => {
  console.error("[backfill-0004] ERREUR :", err);
  process.exit(1);
});
