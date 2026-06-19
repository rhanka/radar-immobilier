/**
 * pull-geo-ogc — Script CLI pour tirer les collections OGC geo (lots + zones)
 * vers Postgres (lot_versions / zone_versions).
 *
 * ## Usage
 *
 *   node api/dist/scripts/pull-geo-ogc.js <ville1> [<ville2> ...]
 *   node api/dist/scripts/pull-geo-ogc.js saint-eustache sainte-catherine
 *   node api/dist/scripts/pull-geo-ogc.js --no-zones saint-eustache
 *   node api/dist/scripts/pull-geo-ogc.js --no-lots saint-eustache
 *
 * ## Variables d'environnement requises
 *
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
 *
 *   GEO_OGC_BASE_URL  optionnel (défaut: https://api.geo.sent-tech.ca)
 *   GEO_OGC_PAGE_SIZE optionnel (défaut: 10000)
 *
 * ## Commande prod (Job k8s)
 *
 *   node api/dist/scripts/pull-geo-ogc.js saint-eustache sainte-catherine
 *
 * ## Idempotence
 *
 * Ré-exécutable sans créer de doublons.
 * Upsert manuel (SELECT puis INSERT/UPDATE) sur (no_lot/code_affiche, city_slug)
 * WHERE known_to IS NULL. Pas de ON CONFLICT (contrainte unique absente).
 *
 * ## Loi 25 / anti-PII
 *
 * Cadastre public (NO_LOT + géom), zonage public (code + géom). Aucun PII.
 */

import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "../db/client.js";
import { pullGeoOgc } from "../services/geo/ogc-pull.js";

// ─── Parsing des arguments ────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  citySlugs: string[];
  pullLots: boolean;
  pullZones: boolean;
} {
  const args = argv.slice(2);
  let pullLots = true;
  let pullZones = true;
  const citySlugs: string[] = [];

  for (const arg of args) {
    if (arg === "--no-lots") {
      pullLots = false;
    } else if (arg === "--no-zones") {
      pullZones = false;
    } else if (!arg.startsWith("--")) {
      citySlugs.push(arg);
    }
  }

  return { citySlugs, pullLots, pullZones };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  const { citySlugs, pullLots, pullZones } = parseArgs(process.argv);

  if (citySlugs.length === 0) {
    logger.error(
      {},
      "pull-geo-ogc: aucune ville fournie. Usage : node pull-geo-ogc.js <ville1> [<ville2> ...]",
    );
    process.exit(1);
  }

  const baseUrl =
    process.env["GEO_OGC_BASE_URL"] ?? "https://api.geo.sent-tech.ca";
  const pageSize = process.env["GEO_OGC_PAGE_SIZE"]
    ? parseInt(process.env["GEO_OGC_PAGE_SIZE"], 10)
    : 10_000;

  logger.info(
    {
      citySlugs,
      pullLots,
      pullZones,
      baseUrl,
      pageSize,
    },
    "pull-geo-ogc: démarrage",
  );

  const { db, pool } = createDb(config);

  // Borner la mémoire Node (les lots sont de gros GeoJSON polygones)
  // NODE_OPTIONS=--max-old-space-size=2048 est conseillé pour les grosses villes
  // mais n'est pas forcé ici — le conducteur s'en charge via le Job k8s.

  let exitCode = 0;

  try {
    const results = await pullGeoOgc(db, pool, citySlugs, {
      baseUrl,
      pageSize,
      pullLots,
      pullZones,
      logger: {
        info: (obj, msg) => {
          if (msg) logger.info(obj as object, msg);
          else logger.info(obj as object);
        },
        warn: (obj, msg) => {
          if (msg) logger.warn(obj as object, msg);
          else logger.warn(obj as object);
        },
        error: (obj, msg) => {
          if (msg) logger.error(obj as object, msg);
          else logger.error(obj as object);
        },
      },
    });

    // ─── Bilan ───────────────────────────────────────────────────────────────
    logger.info("pull-geo-ogc: ═══════════════════════════════════════════════");
    logger.info(`pull-geo-ogc: BILAN — ${new Date().toISOString()}`);
    logger.info("pull-geo-ogc: ─────────────────────────────────────────────");

    let totalLots = 0;
    let totalZones = 0;
    let totalErrors = 0;

    for (const r of results) {
      totalLots += r.lotsUpserted;
      totalZones += r.zonesUpserted;
      totalErrors += r.errors.length;
      const status = r.errors.length > 0 ? "[ERREUR]" : "[OK]";
      logger.info(
        `pull-geo-ogc: ${status} ${r.citySlug}: lots=${r.lotsUpserted}(skip=${r.lotsSkipped}) zones=${r.zonesUpserted}(skip=${r.zonesSkipped})${r.errors.length > 0 ? " errors=" + r.errors.join(";") : ""}`,
      );
    }

    logger.info(
      `pull-geo-ogc: Total lots=${totalLots} zones=${totalZones} erreurs=${totalErrors}`,
    );
    logger.info("pull-geo-ogc: ═══════════════════════════════════════════════");

    if (totalErrors > 0) {
      exitCode = 1;
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "pull-geo-ogc: ERREUR FATALE",
    );
    exitCode = 1;
  } finally {
    await pool.end();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("pull-geo-ogc: fatal", err);
  process.exit(1);
});
