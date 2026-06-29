#!/usr/bin/env tsx
/**
 * Backfill idempotent — tracking drizzle de la migration 0009_account_invitations
 *
 * CONTEXTE (dette #69 — tracking drizzle incohérent)
 * --------------------------------------------------
 * La migration `api/drizzle/0009_account_invitations.sql` (table
 * account_invitations + CHECK 'invited' sur account_users) a été appliquée
 * MANUELLEMENT en prod (hors migrator) : la table account_invitations existe
 * et porte des données réelles, et la contrainte account_users_status_check
 * inclut déjà 'invited'. MAIS la table `drizzle.__drizzle_migrations` ne
 * contient PAS la ligne correspondante, et le journal de `main` s'arrête à 0008.
 *
 * Conséquence si on lance `node dist/db/migrate.js` avec un journal qui inclut
 * 0009 (ce que fait la branche feat/zero-copy-geo-convergence, qui ajoute
 * 0009 ET 0010 au journal) : drizzle, dont le dernier created_at appliqué est
 * 1781730000000 (= 0008), appliquera toute entrée du journal dont `when` est
 * supérieur → il REJOUE 0009 → `CREATE TABLE account_invitations` échoue
 * (table déjà existante, 5 lignes de données) → le job de migration PLANTE et
 * 0010 (zero-copy index) n'est JAMAIS appliquée.
 *
 * CE QUE CE SCRIPT FAIT
 * ---------------------
 * 1. Vérifie si la ligne de tracking 0009 est déjà présente (hash check).
 * 2. Si absente → insère la ligne (hash + created_at) dans
 *    drizzle.__drizzle_migrations.
 * 3. Si déjà présente → no-op (idempotent, ré-exécutable sans dégât).
 *
 * Après exécution, le migrator considère 0009 comme déjà appliquée et passe
 * directement à 0010. AUCUN DDL, AUCUNE perte de données : un seul INSERT
 * idempotent dans la table de tracking.
 *
 * RUNBOOK PROD (à exécuter AVANT le job de migration du lot zero-copy)
 * -------------------------------------------------------------------
 * Prérequis : variables POSTGRES_* (ou env de prod via docker/k8s).
 * Valider en staging d'abord.
 *
 *   # 1. État actuel (dernier created_at doit être 1781730000000 = 0008)
 *   kubectl exec -n radar-immobilier radar-postgres-0 -- \
 *     psql -U radar -d radar \
 *     -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"
 *
 *   # 2. Exécuter le backfill (idempotent)
 *   cd api && npx tsx src/db/scripts/backfill-0009-tracking.ts
 *
 *   # 3. Vérifier le résultat (la ligne 0009 hash=6ec16e… created_at=1781740000000
 *   #    doit apparaître ; total = 10 lignes 0000..0009)
 *   kubectl exec -n radar-immobilier radar-postgres-0 -- \
 *     psql -U radar -d radar \
 *     -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"
 *
 *   # 4. Lancer le job de migration : 0009 est skip, seul 0010 s'applique
 *   #    Attendu : "migrations applied" sans rejeu de 0009.
 *
 * COMMENT EST CALCULÉ LE HASH
 * ---------------------------
 * Drizzle calcule : SHA256(contenu_text_du_fichier_sql).digest('hex')
 * Ref : node_modules/drizzle-orm/migrator.js
 * Hash 0009 : sha256sum api/drizzle/0009_account_invitations.sql
 *   → 6ec16ed6d5d07061c6c9eb580e755ba77b1e5a3637c66283c3ef9a5d276cc4d5
 *
 * LE created_at (BIGINT)
 * ----------------------
 * Drizzle stocke `folderMillis` = champ `when` du _journal.json (ms epoch).
 * On utilise 1781740000000, identique au `when` que la branche zero-copy
 * (commit f405eec) assigne à l'entrée idx 9 du journal, et postérieur à 0008
 * (1781730000000). Cohérence journal ↔ tracking garantie.
 */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Paramètres de la migration 0009 ─────────────────────────────────────────
const SQL_PATH = resolve(__dirname, "../../../drizzle/0009_account_invitations.sql");
const MIGRATION_WHEN = 1781740000000; // = `when` de l'entrée idx 9 du journal (zero-copy L1)

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
      console.log(`[backfill-0009] Ligne déjà présente (hash=${MIGRATION_HASH.slice(0, 16)}…) — rien à faire.`);
      return;
    }

    // Insérer la ligne de tracking
    await client.query(
      `INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at) VALUES ($1, $2)`,
      [MIGRATION_HASH, MIGRATION_WHEN],
    );

    console.log(`[backfill-0009] Ligne insérée avec succès :`);
    console.log(`  hash       = ${MIGRATION_HASH}`);
    console.log(`  created_at = ${String(MIGRATION_WHEN)} (${new Date(MIGRATION_WHEN).toISOString()})`);
    console.log(`[backfill-0009] Vérifier : SELECT * FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} ORDER BY created_at;`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err: unknown) => {
  console.error("[backfill-0009] ERREUR :", err);
  process.exit(1);
});
