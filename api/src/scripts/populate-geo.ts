/**
 * populate-geo — Peuple les polygones de zones/lots + lance la résolution géo.
 *
 * ## Usage
 *
 *   node api/dist/scripts/populate-geo.js                          # toutes villes du registre
 *   node api/dist/scripts/populate-geo.js longueuil shawinigan     # villes sélectives
 *   node api/dist/scripts/populate-geo.js --no-lots longueuil      # zones seulement
 *   node api/dist/scripts/populate-geo.js --no-resolve longueuil   # pas de résolution
 *
 * ## Variables d'environnement requises (DB)
 *
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
 *
 * ## Commande k8s prod (Job one-shot)
 *
 *   kubectl -n radar exec -it <pod> -- \
 *     node api/dist/scripts/populate-geo.js longueuil shawinigan sherbrooke saguenay
 *
 * ## Idempotence
 *
 * Peut être relancé sans créer de doublons.
 * INSERT ... ON CONFLICT DO UPDATE sur (canonical_id) WHERE known_to IS NULL.
 *
 * ## Bornage lots
 *
 * Le peuplement des lots utilise la bbox de la commune (STRICT).
 * Les villes demo lots par défaut : longueuil + saguenay.
 * Pour activer d'autres villes lots : passer --lot-cities=longueuil,sherbrooke
 *
 * ## Loi 25
 *
 * Zonage public, cadastre public (NO_LOT + géom), aucun PII.
 */

import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "../db/client.js";
import {
  populateGeo,
  DEFAULT_LOT_CITIES,
  type PopulateGeoOptions,
} from "../services/geo/populate-geo.js";

// ─── Parsing des arguments ────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  citySlugs: string[] | undefined;
  noLots: boolean;
  noResolve: boolean;
  lotCities: string[] | undefined;
} {
  const args = argv.slice(2); // skip node + script path

  let noLots = false;
  let noResolve = false;
  let lotCities: string[] | undefined;
  const slugArgs: string[] = [];

  for (const arg of args) {
    if (arg === "--no-lots") {
      noLots = true;
    } else if (arg === "--no-resolve") {
      noResolve = true;
    } else if (arg.startsWith("--lot-cities=")) {
      const val = arg.slice("--lot-cities=".length);
      lotCities = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (!arg.startsWith("--")) {
      slugArgs.push(arg);
    }
  }

  return {
    citySlugs: slugArgs.length > 0 ? slugArgs : undefined,
    noLots,
    noResolve,
    lotCities,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  const { citySlugs, noLots, noResolve, lotCities } = parseArgs(process.argv);

  logger.info(
    {
      citySlugs: citySlugs ?? "tous les registres",
      noLots,
      noResolve,
      lotCities: lotCities ?? [...DEFAULT_LOT_CITIES],
    },
    "populate-geo: démarrage script",
  );

  const { db, pool } = createDb(config);

  const options: PopulateGeoOptions = {
    ...(citySlugs !== undefined ? { citySlugs } : {}),
    populateLots: !noLots,
    lotCitySlugs: lotCities ?? [...DEFAULT_LOT_CITIES],
    runResolution: !noResolve,
    logger: {
      info: (msgOrObj, ...args) => {
        if (typeof msgOrObj === "string") {
          logger.info(args[0] ?? {}, msgOrObj);
        } else {
          logger.info(msgOrObj);
        }
      },
      warn: (msgOrObj, ...args) => {
        if (typeof msgOrObj === "string") {
          logger.warn(args[0] ?? {}, msgOrObj);
        } else {
          logger.warn(msgOrObj);
        }
      },
      error: (msgOrObj, ...args) => {
        if (typeof msgOrObj === "string") {
          logger.error(args[0] ?? {}, msgOrObj);
        } else {
          logger.error(msgOrObj);
        }
      },
    },
  };

  let exitCode = 0;

  try {
    const result = await populateGeo(db, options);

    // ─── Bilan console ────────────────────────────────────────────────────────
    logger.info("populate-geo: ═══════════════════════════════════════════════");
    logger.info(`populate-geo: BILAN G2 — ${new Date().toISOString()}`);
    logger.info("populate-geo: ─────────────────────────────────────────────");
    logger.info(
      `populate-geo: Villes traitées : ${result.citiesProcessed} | OK : ${result.citiesOk} | Erreurs : ${result.citiesErrored}`,
    );
    logger.info(`populate-geo: Zones upsertées : ${result.totalZonesUpserted}`);
    logger.info(`populate-geo: Lots upsertés   : ${result.totalLotsUpserted}`);

    const totalResolu = result.totalSignalsResolved;
    const totalNonResolu = result.totalSignalsUnresolved;
    const total = totalResolu + totalNonResolu;

    if (total > 0) {
      const taux = ((totalResolu / total) * 100).toFixed(1);
      logger.info(
        `populate-geo: Résolution géo : ${totalResolu}/${total} = ${taux}%`,
      );
    } else {
      logger.info("populate-geo: Résolution géo : 0 signaux à résoudre");
    }

    logger.info("populate-geo: ─────────────────────────────────────────────");
    logger.info("populate-geo: Détail par ville :");
    for (const city of result.byCity) {
      const res = city.resolution;
      if (city.error) {
        logger.info(
          `populate-geo:   [ERREUR] ${city.citySlug} — ${city.error}`,
        );
      } else if (res) {
        const cityTaux =
          res.total > 0
            ? (
                ((res.resolvedZones + res.resolvedLots) / res.total) *
                100
              ).toFixed(1)
            : "N/A";
        logger.info(
          `populate-geo:   ${city.citySlug}: zones=${city.zonesUpserted} lots=${city.lotsUpserted} résolution=${res.resolvedZones + res.resolvedLots}/${res.total} (${cityTaux}%)`,
        );
      } else {
        logger.info(
          `populate-geo:   ${city.citySlug}: zones=${city.zonesUpserted} lots=${city.lotsUpserted} (pas de résolution)`,
        );
      }
    }
    logger.info("populate-geo: ═══════════════════════════════════════════════");

    if (result.citiesErrored > 0) {
      exitCode = 1;
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "populate-geo: ERREUR FATALE",
    );
    exitCode = 1;
  } finally {
    await pool.end();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("populate-geo: fatal", err);
  process.exit(1);
});
