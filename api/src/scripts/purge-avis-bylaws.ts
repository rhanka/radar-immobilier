/**
 * purge-avis-bylaws — SUPPRESSION CHIRURGICALE des avis-Bylaws stale (LOT 1, re-seed Lot C).
 *
 * CONTEXTE (mesuré i-arch sur préprod) : avant Lot B, un avis de motion émettait
 * DEUX nœuds pour un même n° — un `Bylaw` (faux règlement ferme) ET un
 * `DesignationEvent(avis_motion)`. Lot B (#544) a stoppé la SOURCE, mais les
 * anciens avis-Bylaws PERSISTENT dans `graph/<city>/latest.json` (upsertGraph était
 * additif) → 026-508 survit NODE-LEVEL + parité agrégée faussement verte. Un
 * nœud frère `avis_motion` (Signal si l'avis est non-zonage, DesignationEvent si
 * zonage) est DÉJÀ présent ⟹ le fix = REMOVAL-ONLY (0 re-exploit).
 *
 * MÉCANISME (modèle `filet-auto-link-pv`, latest.json = graphe IMMO complet, PAS
 * de geo dans graph_nodes) : par ville → `readCanonicalCityGraph` → retirer les
 * avis-Bylaws ciblés + leurs edges → `archiveCityGraphPrefix` (rollback) →
 * `writeCanonicalCityGraph` (gardé) → `upsertGraphAtomic` INLINE (lockstep S3+PG :
 * supprime les Bylaws orphelins de PG, edges pendantes, et `buildNodeRow` tamponne
 * `regulatoryStatus=anticipation` sur les DesignationEvent survivants). Ordre
 * latest.json-FIRST (si PG échoue, un reproject ultérieur répare depuis la vérité).
 *
 * SÛRETÉ (i-arch) — DERIVE-LIVE + ASSERT-vs-ORACLE :
 *  - la cible est CALCULÉE en direct du latest.json courant via `isReglementAvisOnly`
 *    (@radar/domain, prédicat single-source #546), PAS un static-list périmable ;
 *  - ASSERT : {avis-Bylaws dérivés-live} == {oracle-Bylaws ENCORE PRÉSENTS} ; mismatch
 *    ⟹ **HALT ville** (0 removal) — fail-safe sur HALT, jamais sur wrong-removal.
 *    (Comparer à l'oracle-PRÉSENT rend l'outil IDEMPOTENT : re-run → dérivé=[]==présent=[].)
 *  - pré-flight belt-and-suspenders : chaque cible a un nœud frère `avis_motion`
 *    (Signal OU DesignationEvent) qui survivra au retrait — un avis non-zonage
 *    survit en Signal (consumer-safety : SIGNAL_NODE_TYPES={Signal,DesignationEvent},
 *    Bylaw non-servi) → sinon SKIP+flag (ne perd pas la représentation de l'avis).
 *
 * PROD-SAFETY : dry-run par défaut / `--apply` ; isolé par-ville ; idempotent ;
 * archive obligatoire. L'écriture (préprod S3 + reproject PG) = exécutée par k8s ;
 * ce process log le bucket cible. `--oracle <path>` (le TSV fixture-72 checked-in).
 *
 * Usage : node dist/scripts/purge-avis-bylaws.js --oracle <avis-only-72.tsv> [--apply] [<city…>]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isReglementAvisOnly } from "@radar/domain";

import { loadConfig, resolveGraphS3Config } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "../db/client.js";
import { createScrapeS3Client, S3ObjectStore } from "../storage/s3-object-store.js";
import {
  archiveCityGraphPrefix,
  readCanonicalCityGraph,
  writeCanonicalCityGraph,
} from "../services/graph/canonical-graph-writer.js";
import { upsertGraphAtomic } from "../services/graph/graph-store.js";

// ── Helpers PURS (extraction props / n° A1-safe / etape) ──────────────────────

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Props du nœud latest.json (`node.properties`) avec repli défensif `node.props.properties`. */
function nodeProperties(node: Record<string, unknown>): Record<string, unknown> {
  const direct = record(node.properties);
  if (Object.keys(direct).length > 0) return direct;
  return record(record(node.props).properties);
}

function firstStr(rec: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** Clé de dédup d'un n° de règlement (casse + espaces neutralisés). */
export function normalizeReglementKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, "");
}

/**
 * Clé de n° A1-safe (§5) : le `DesignationEvent` d'un avis porte le n° dans la
 * CIBLE (`cibleReglementNumero`), PAS dans son identité ; le `Bylaw`/`Signal`
 * porte son propre n°. Le grouping DOIT unifier les trois sous la même clé, sinon
 * les `etapes` n'agrègent pas et `isReglementAvisOnly` misfire (l'ASSERT==oracle
 * l'attrape en HALT, jamais en removal aveugle).
 */
export function nodeReglementKey(node: Record<string, unknown>): string | null {
  const p = nodeProperties(node);
  const type = typeof node.type === "string" ? node.type : "";
  const cible = ["cibleReglementNumero", "cible_reglement_numero"];
  const own = ["reglement_number", "reglementNumero", "numero"];
  const order = type === "DesignationEvent" ? [...cible, ...own] : [...own, ...cible];
  const raw = firstStr(p, order);
  return raw === null ? null : normalizeReglementKey(raw);
}

/** Étape servie (top-level `etape` puis `properties.etape`), lowercase, null si absente. */
export function nodeEtape(node: Record<string, unknown>): string | null {
  const top = typeof node.etape === "string" && node.etape.trim().length > 0 ? node.etape.trim() : null;
  const nested = firstStr(nodeProperties(node), ["etape"]);
  const value = top ?? nested;
  return value === null ? null : value.toLowerCase();
}

// ── Cœur PUR testable : planCityPurge ─────────────────────────────────────────

export interface CityPurgePlan {
  readonly city: string;
  /** derived-live == oracle-present. Si false → HALT (0 removal). */
  readonly assertOk: boolean;
  readonly assertDiff: { onlyDerived: string[]; onlyOraclePresent: string[] } | null;
  readonly removed: string[];
  readonly skipped: { nodeId: string; reason: string }[];
  readonly nextGraph: Record<string, unknown>;
  readonly changed: boolean;
}

interface Group {
  etapes: Set<string>;
  bylawIds: string[];
  hasAvisMotionSibling: boolean;
}

/**
 * Plan PUR de purge d'une ville. Ne mute rien (retourne `nextGraph`). N'écrit pas.
 * @param graph                 le latest.json parsé de la ville
 * @param city                  slug (pour le rapport)
 * @param oracleBylawIdsForCity les bylaw_node_id de l'oracle-72 pour cette ville
 */
export function planCityPurge(
  graph: Record<string, unknown>,
  city: string,
  oracleBylawIdsForCity: readonly string[],
): CityPurgePlan {
  const nodes = Array.isArray(graph.nodes) ? (graph.nodes as Record<string, unknown>[]) : [];
  const nodeById = new Map<string, Record<string, unknown>>();
  for (const n of nodes) {
    const id = typeof n.id === "string" ? n.id : null;
    if (id !== null) nodeById.set(id, n);
  }

  // Grouping A1-safe par clé de n°.
  const byNumero = new Map<string, Group>();
  for (const n of nodes) {
    const key = nodeReglementKey(n);
    if (key === null) continue;
    let g = byNumero.get(key);
    if (g === undefined) {
      g = { etapes: new Set(), bylawIds: [], hasAvisMotionSibling: false };
      byNumero.set(key, g);
    }
    const et = nodeEtape(n);
    if (et !== null) g.etapes.add(et);
    const type = typeof n.type === "string" ? n.type : "";
    const id = typeof n.id === "string" ? n.id : null;
    if (type === "Bylaw" && id !== null) g.bylawIds.push(id);
    // relax (consumer-safety, #546) : un Signal(avis_motion) est une représentation
    // survivante valide au même titre qu'un DesignationEvent — un avis non-zonage
    // est porté par un Signal (jamais un DE). Retirer le Bylaw ghost ne perd rien.
    if ((type === "DesignationEvent" || type === "Signal") && et === "avis_motion") {
      g.hasAvisMotionSibling = true;
    }
  }

  // DERIVE-LIVE : les Bylaw des groupes avis-only (prédicat single-source #546).
  const derivedBylawIds: string[] = [];
  const groupOfBylaw = new Map<string, Group>();
  for (const g of byNumero.values()) {
    if (g.bylawIds.length > 0 && isReglementAvisOnly(g.etapes)) {
      for (const bid of g.bylawIds) {
        derivedBylawIds.push(bid);
        groupOfBylaw.set(bid, g);
      }
    }
  }

  // ASSERT == oracle ENCORE PRÉSENT (idempotence : re-run → dérivé=[]==présent=[]).
  const oraclePresentSet = new Set(oracleBylawIdsForCity.filter((id) => nodeById.has(id)));
  const derivedSet = new Set(derivedBylawIds);
  const onlyDerived = [...derivedSet].filter((id) => !oraclePresentSet.has(id)).sort();
  const onlyOraclePresent = [...oraclePresentSet].filter((id) => !derivedSet.has(id)).sort();
  const assertOk = onlyDerived.length === 0 && onlyOraclePresent.length === 0;

  if (!assertOk) {
    return {
      city,
      assertOk: false,
      assertDiff: { onlyDerived, onlyOraclePresent },
      removed: [],
      skipped: [],
      nextGraph: graph,
      changed: false,
    };
  }

  // PRÉ-FLIGHT (a) belt-and-suspenders : chaque cible a un nœud frère avis_motion
  // (Signal OU DesignationEvent) qui survivra au retrait du Bylaw ghost.
  const toRemove = new Set<string>();
  const skipped: { nodeId: string; reason: string }[] = [];
  for (const bid of derivedBylawIds) {
    const g = groupOfBylaw.get(bid)!;
    if (!g.hasAvisMotionSibling) {
      skipped.push({ nodeId: bid, reason: "no-sibling-avis-node" });
      continue;
    }
    toRemove.add(bid);
  }

  if (toRemove.size === 0) {
    return { city, assertOk: true, assertDiff: null, removed: [], skipped, nextGraph: graph, changed: false };
  }

  // REMOVE : nœuds ciblés + edges/links référençant un id retiré (source OU target).
  const nextNodes = nodes.filter((n) => !(typeof n.id === "string" && toRemove.has(n.id)));
  const pruneEdges = (arr: unknown): unknown[] | undefined => {
    if (!Array.isArray(arr)) return undefined;
    return arr.filter((e) => {
      const r = record(e);
      const src = firstStr(r, ["source", "src", "srcId", "from"]);
      const dst = firstStr(r, ["target", "dst", "dstId", "to"]);
      return !(src !== null && toRemove.has(src)) && !(dst !== null && toRemove.has(dst));
    });
  };
  const nextGraph: Record<string, unknown> = { ...graph, nodes: nextNodes };
  const nextEdges = pruneEdges(graph.edges);
  if (nextEdges !== undefined) nextGraph.edges = nextEdges;
  const nextLinks = pruneEdges(graph.links);
  if (nextLinks !== undefined) nextGraph.links = nextLinks;

  return { city, assertOk: true, assertDiff: null, removed: [...toRemove].sort(), skipped, nextGraph, changed: true };
}

/** Parse le TSV oracle (`city\treglement_number\tbylaw_node_id`) → bylaw_node_ids par ville. */
export function parseOracleTsv(tsv: string): Map<string, string[]> {
  const byCity = new Map<string, string[]>();
  const lines = tsv.split(/\r?\n/u).filter((l) => l.trim().length > 0);
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const city = cols[0]?.trim();
    const bylawNodeId = cols[2]?.trim();
    if (!city || !bylawNodeId) continue;
    const arr = byCity.get(city) ?? [];
    arr.push(bylawNodeId);
    byCity.set(city, arr);
  }
  return byCity;
}

// ── main() — isolé par-ville, dry-run/--apply, modèle filet ───────────────────

const DEFAULT_ORACLE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../services/graph/__fixtures__/avis-only-72.tsv",
);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const oracleIdx = args.indexOf("--oracle");
  const oraclePath = oracleIdx >= 0 ? (args[oracleIdx + 1] ?? "") : DEFAULT_ORACLE_PATH;
  const cities = args.filter(
    (a, i) => !a.startsWith("--") && !(oracleIdx >= 0 && i === oracleIdx + 1),
  );

  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  let oracleByCity: Map<string, string[]>;
  try {
    oracleByCity = parseOracleTsv(readFileSync(oraclePath, "utf8"));
  } catch (err) {
    logger.error(
      { oraclePath, err: err instanceof Error ? err.message : String(err) },
      "purge-avis-bylaws: oracle illisible — REFUS (l'ASSERT ne peut pas tourner sans oracle)",
    );
    process.exit(2);
    return;
  }

  const targetCities = cities.length > 0 ? cities : [...oracleByCity.keys()].sort();
  const graphS3Config = resolveGraphS3Config(config);
  const store = new S3ObjectStore(createScrapeS3Client(graphS3Config), graphS3Config.bucket);
  const { db } = createDb(config);
  const backupId = `purge-avis-bylaws-${new Date().toISOString().replaceAll(":", "-").replace(".", "-")}`;

  logger.info(
    { bucket: graphS3Config.bucket, apply, cities: targetCities.length, mode: apply ? "APPLY" : "DRY-RUN" },
    "purge-avis-bylaws: démarrage (removal-only latest.json + reproject inline)",
  );

  let removedTotal = 0;
  let halted = 0;
  let reprojected = 0;
  let aborted = 0;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  for (const city of targetCities) {
    const oracleIds = oracleByCity.get(city) ?? [];
    let read: Awaited<ReturnType<typeof readCanonicalCityGraph>>;
    try {
      read = await readCanonicalCityGraph(store, city);
    } catch (err) {
      logger.warn({ city, err: String(err) }, "purge: latest.json illisible, ville ignorée");
      continue;
    }
    if (read === null) {
      logger.warn({ city }, "purge: latest.json absent, ville ignorée");
      continue;
    }

    let graph: Record<string, unknown>;
    try {
      graph = JSON.parse(decoder.decode(read.body)) as Record<string, unknown>;
    } catch (err) {
      logger.warn({ city, err: String(err) }, "purge: latest.json JSON invalide, ville ignorée");
      continue;
    }

    const plan = planCityPurge(graph, city, oracleIds);

    if (!plan.assertOk) {
      halted++;
      logger.error(
        { city, assertDiff: plan.assertDiff },
        "purge: HALT — dérivé-live != oracle-présent (drift/grouping) — 0 removal sur cette ville",
      );
      continue;
    }

    if (plan.skipped.length > 0) {
      logger.warn({ city, skipped: plan.skipped }, "purge: cibles SKIP (pas de nœud frère avis_motion Signal|DesignationEvent)");
    }

    if (!plan.changed) {
      logger.info({ city }, "purge: rien à retirer (idempotent : déjà propre)");
      continue;
    }

    logger.info({ city, removed: plan.removed }, `purge: ${plan.removed.length} avis-Bylaw(s) ciblé(s)`);

    if (!apply) {
      logger.info({ city, count: plan.removed.length }, "purge: DRY-RUN — non écrit (relancer avec --apply)");
      removedTotal += plan.removed.length;
      continue;
    }

    // APPLY — ordre filet : archive → writeCanonicalCityGraph (gardé) → upsertGraphAtomic (inline).
    const body = encoder.encode(JSON.stringify(plan.nextGraph, null, 2));
    const archive = await archiveCityGraphPrefix(store, city, backupId);
    await writeCanonicalCityGraph(store, { citySlug: city, body, archive, readAnchor: read.anchor });
    logger.info({ city, backupPrefix: archive.backup_prefix, objects: archive.object_count }, "purge: préfixe archivé + latest.json écrit (S3)");
    removedTotal += plan.removed.length;

    const result = await upsertGraphAtomic(db, city, plan.nextGraph);
    if (result.aborted) {
      aborted++;
      logger.error({ city, reason: result.reason }, "purge: REPROJECTION ABORTÉE (anormal — investiguer)");
    } else {
      reprojected++;
      logger.info({ city, nodes: result.nodeCount, edges: result.edgeCount }, "purge: ville reprojetée (PG, avis-Bylaws supprimés)");
    }
  }

  logger.info(
    { cities: targetCities.length, removedTotal, halted, reprojected, aborted, apply },
    "purge-avis-bylaws: terminé",
  );
  process.exit(halted > 0 || aborted > 0 ? 1 : 0);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("purge-avis-bylaws: fatal", err);
    process.exit(1);
  });
}
