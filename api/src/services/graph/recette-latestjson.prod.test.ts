import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { snapshotFromExistingCity } from "./graphify-34-snapshot.js";

/**
 * Producteur de latest.json ≥prod pour le fix S3-régression (3 villes).
 * Anti-invention : nodes/edges = sortie de `snapshotFromExistingCity` (l'outil
 * immo) sur le subgraph PROD PG autoritaire ; métadonnées (municipality,
 * ontology_version, generated_at, pv_count) PRÉSERVÉES de l'objet S3 existant.
 * On ne fabrique AUCUNE valeur : contenu = prod PG, méta = S3 existant.
 *
 * SKIPPÉ sauf si RECETTE_SUBGRAPH_DIR + RECETTE_S3META_DIR + RECETTE_LATEST_OUT.
 */

const SUBGRAPH_DIR = process.env.RECETTE_SUBGRAPH_DIR ?? "";
const S3META_DIR = process.env.RECETTE_S3META_DIR ?? "";
const OUT_DIR = process.env.RECETTE_LATEST_OUT ?? "";
const SLUGS = (process.env.RECETTE_LATEST_SLUGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const RUN = Boolean(SUBGRAPH_DIR && S3META_DIR && OUT_DIR && SLUGS.length);

describe("recette latest.json ≥prod (fix S3-régression)", () => {
  (RUN ? it : it.skip)(
    "produit les latest.json ≥prod via snapshotFromExistingCity",
    () => {
      for (const slug of SLUGS) {
        const sub = JSON.parse(readFileSync(join(SUBGRAPH_DIR, `${slug}.subgraph.json`), "utf8"));
        const snap = snapshotFromExistingCity({
          citySlug: sub.citySlug,
          nodes: sub.nodes,
          edges: sub.edges,
        } as never);

        // métadonnées préservées de l'objet S3 existant (aucune invention)
        const meta = JSON.parse(readFileSync(join(S3META_DIR, `${slug}.json`), "utf8"));
        const edges = snap.edges ?? [];
        const out = {
          ...meta,
          nodes: snap.nodes,
          edges,
        };
        writeFileSync(join(OUT_DIR, `${slug}.latest.json`), JSON.stringify(out, null, 1), "utf8");
        console.log(
          `RECETTE_LATEST ${slug} nodes=${snap.nodes.length} edges=${edges.length} ` +
            `(S3 avant: nodes=${(meta.nodes ?? []).length})`,
        );
        expect(snap.nodes.length).toBeGreaterThan((meta.nodes ?? []).length);
      }
    },
    60000,
  );
});
