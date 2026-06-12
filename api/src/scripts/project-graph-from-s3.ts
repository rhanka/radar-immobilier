/**
 * project-graph-from-s3 — projette les graphes graphify SCW dans Postgres.
 *
 * Lit `graph/<ville>/latest.json` depuis le bucket SCW (GRAPH_S3_* / SCRAPE_S3_*)
 * et appelle `upsertGraph(db, citySlug, graphJson)` pour chaque fichier qui
 * contient un champ `nodes` valide.
 *
 * Idempotent : upsert ON CONFLICT, relancer est sûr.
 *
 * Usage :
 *   tsx src/scripts/project-graph-from-s3.ts                  # toutes les villes
 *   tsx src/scripts/project-graph-from-s3.ts drummondville ogden joliette
 *
 * Variables d'environnement (lues depuis process.env) :
 *   GRAPH_S3_ENDPOINT, GRAPH_S3_BUCKET, GRAPH_S3_ACCESS_KEY, GRAPH_S3_SECRET_KEY
 *   GRAPH_S3_REGION, GRAPH_S3_FORCE_PATH_STYLE
 *   (chacun se rabat sur SCRAPE_S3_* puis S3_*)
 *
 * Format SCW attendu (graphify v2) :
 *   { nodes: [{ id, type, label, status?, description?, refs? }],
 *     edges: [{ source, target, type|relation, refs? }] }
 * ou le format graphify v1 classique :
 *   { nodes: [{ id, label, file_type? }], links: [{ source, target, relation }] }
 */

import { loadConfig, resolveGraphS3Config } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "../db/client.js";
import {
  createScrapeS3Client,
  S3ObjectStore,
} from "../storage/s3-object-store.js";
import { upsertGraph } from "../services/graph/graph-store.js";

const decoder = new TextDecoder();

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const graphS3Config = resolveGraphS3Config(config);

  logger.info(
    {
      endpoint: graphS3Config.endpoint,
      bucket: graphS3Config.bucket,
      region: graphS3Config.region,
    },
    "project-graph-from-s3: connecting to graph object store",
  );

  const s3Client = createScrapeS3Client(graphS3Config);
  const store = new S3ObjectStore(s3Client, graphS3Config.bucket);

  const { db, pool } = createDb(config);

  // Slugs explicites en arguments, ou toutes les villes disponibles.
  const argSlugs = process.argv.slice(2);

  let keys: string[];
  if (argSlugs.length > 0) {
    // Mode sélectif : construire les clés depuis les slugs fournis.
    keys = argSlugs.map((slug) => `graph/${slug}/latest.json`);
    logger.info({ slugs: argSlugs }, "project-graph-from-s3: mode sélectif");
  } else {
    // Mode complet : lister tout le préfixe graph/.
    logger.info("project-graph-from-s3: mode complet — listage graph/*");
    keys = (await store.list?.("graph/")) ?? [];
    // Ne garder que les latest.json (pas les snapshots historiques éventuels).
    keys = keys.filter((k) => k.endsWith("/latest.json"));
    logger.info({ total: keys.length }, "project-graph-from-s3: clés trouvées");
  }

  let ok = 0;
  let skipped = 0;
  let errors = 0;

  for (const key of keys) {
    // Extraire le citySlug depuis la clé : graph/<citySlug>/latest.json
    const parts = key.split("/");
    const citySlug = parts[1] ?? key;

    let raw: Uint8Array;
    try {
      raw = await store.get(key);
    } catch (err) {
      logger.warn({ key, err: String(err) }, "project-graph-from-s3: GET échoué, ignoré");
      skipped++;
      continue;
    }

    let graphJson: unknown;
    try {
      graphJson = JSON.parse(decoder.decode(raw));
    } catch (err) {
      logger.warn({ key, err: String(err) }, "project-graph-from-s3: JSON invalide, ignoré");
      skipped++;
      continue;
    }

    // Vérification légère avant upsert : doit avoir un champ `nodes`.
    if (
      typeof graphJson !== "object" ||
      graphJson === null ||
      !Array.isArray((graphJson as Record<string, unknown>).nodes)
    ) {
      logger.debug(
        { key },
        "project-graph-from-s3: pas de champ `nodes`, ignoré (résumé ou autre format)",
      );
      skipped++;
      continue;
    }

    try {
      const result = await upsertGraph(db, citySlug, graphJson);
      logger.info(
        { citySlug, nodes: result.nodeCount, edges: result.edgeCount },
        "project-graph-from-s3: ville projetée",
      );
      ok++;
    } catch (err) {
      logger.error({ citySlug, key, err: String(err) }, "project-graph-from-s3: upsert échoué");
      errors++;
    }
  }

  logger.info(
    { ok, skipped, errors, total: keys.length },
    "project-graph-from-s3: terminé",
  );

  await pool.end();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("project-graph-from-s3: fatal", err);
  process.exit(1);
});
