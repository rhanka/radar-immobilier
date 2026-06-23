/**
 * filet-auto-link-pv — FILET : auto-lie les PV PDF (S3) aux nœuds Signal /
 * DesignationEvent qui portent une citation + un `docSha` mais dont le `rawRef`
 * est `null`, alors que le PV existe déjà sur S3 sous
 * `raw/proces-verbaux-<ville>/cas/<docSha>.<ext>`.
 *
 * Dérivation MÉCANIQUE (zéro invention) : le `docSha` du signal pointe déjà vers
 * le PDF exact. On peuple `rawRef` UNIQUEMENT quand `store.head(<clé>)` confirme
 * que le fichier existe réellement. Le lien est marqué `provisional: true` +
 * `linkSource: "radar-auto-link"` pour le distinguer d'un rawRef graphify
 * vérifié — qu'un vrai rawRef non-provisional écrasera à la prochaine
 * reprojection (comportement voulu).
 *
 * Survie à la projection #303 : on écrit dans la SOURCE DE VÉRITÉ
 * (`graph/<ville>/latest.json` sur S3) puis on reprojette via
 * `upsertGraphAtomic`. Le gate de complétude ne peut que MONTER (on ajoute un
 * rawRef sur une ref qui a déjà une citation) → jamais d'abort.
 *
 * Sécurité : préserve toujours les refs/excerpts/docSha existants. Ne lie JAMAIS
 * quand le docSha est absent ou que le PDF n'existe pas (signale à la place).
 *
 * Usage :
 *   tsx src/scripts/filet-auto-link-pv.ts                 # dry-run, villes cibles
 *   tsx src/scripts/filet-auto-link-pv.ts --apply         # écrit S3 + PG
 *   tsx src/scripts/filet-auto-link-pv.ts --apply chelsea levis  # villes choisies
 *
 * Variables d'env : GRAPH_S3_* (rabat sur SCRAPE_S3_* puis S3_*) pour le bucket
 * graphe/PV ; config DB standard pour la reprojection.
 */

import { loadConfig, resolveGraphS3Config } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "../db/client.js";
import { createScrapeS3Client, S3ObjectStore } from "../storage/s3-object-store.js";
import { upsertGraphAtomic } from "../services/graph/graph-store.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Villes prioritaires par défaut (8 villes / 16 nœuds Signal). */
const DEFAULT_CITIES = [
  "chelsea",
  "hemmingford--les-jardins-de-napierville--2",
  "la-sarre",
  "levis",
  "notre-dame-de-lourdes--lerable",
  "plaisance",
  "preissac",
  "rimouski",
];

const SIGNAL_TYPES = new Set(["Signal", "DesignationEvent"]);
/** Extensions probées, dans l'ordre de préférence. */
const RAW_EXTS = ["pdf", "html", "txt"] as const;
const LINK_SOURCE = "radar-auto-link";

interface LinkOutcome {
  city: string;
  nodeId: string;
  status: "linked" | "no-docsha" | "no-pdf" | "already-linked";
  rawRef?: string;
  docSha?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** docSha porté par une ref ou par le bloc properties. */
function readDocSha(rec: Record<string, unknown>): string | null {
  for (const k of ["docSha", "doc_sha", "sha256", "sha"]) {
    if (nonEmptyString(rec[k])) return (rec[k] as string).trim();
  }
  return null;
}

/** Un rawRef déjà présent (n'importe quelle variante de clé). */
function hasExistingRawRef(rec: Record<string, unknown>): boolean {
  for (const k of ["rawRef", "raw_ref", "rawObjectKey", "raw_object_key", "file", "path", "s3Key", "s3_key"]) {
    if (nonEmptyString(rec[k])) return true;
  }
  return false;
}

/**
 * Probe S3 pour trouver l'extension réelle du PV correspondant au docSha.
 * Retourne la clé S3 complète si un fichier existe, sinon null.
 */
async function resolveRawRef(
  store: S3ObjectStore,
  city: string,
  docSha: string,
): Promise<string | null> {
  const prefix = `raw/proces-verbaux-${city}/cas/${docSha}`;
  for (const ext of RAW_EXTS) {
    const key = `${prefix}.${ext}`;
    const info = await store.head(key);
    if (info) return key;
  }
  return null;
}

/**
 * Mute une ref (objet) en lui ajoutant le rawRef provisional, SANS toucher
 * excerpt/citation/docSha. Retourne true si la ref a été modifiée.
 */
function patchRef(ref: Record<string, unknown>, rawRef: string): boolean {
  if (hasExistingRawRef(ref)) return false;
  ref.rawRef = rawRef;
  ref.provisional = true;
  ref.linkSource = LINK_SOURCE;
  return true;
}

/**
 * Applique le filet à un node. Mute `node.refs[]`, `node.properties.refs[]` et
 * `node.properties.rawRef` quand pertinent. Retourne le rawRef posé (ou null).
 */
async function linkNode(
  store: S3ObjectStore,
  city: string,
  node: Record<string, unknown>,
): Promise<{ status: LinkOutcome["status"]; rawRef?: string; docSha?: string }> {
  const props = isRecord(node.properties) ? node.properties : undefined;

  // 1. Récupère le docSha (node-level refs, properties, properties.refs).
  let docSha: string | null = null;
  const nodeRefs = Array.isArray(node.refs) ? (node.refs as unknown[]) : [];
  for (const r of nodeRefs) {
    if (isRecord(r)) {
      const s = readDocSha(r);
      if (s) { docSha = s; break; }
    }
  }
  if (!docSha && props) docSha = readDocSha(props);
  if (!docSha && props && Array.isArray(props.refs)) {
    for (const r of props.refs as unknown[]) {
      if (isRecord(r)) {
        const s = readDocSha(r);
        if (s) { docSha = s; break; }
      }
    }
  }

  // Déjà un rawRef ? rien à faire (un vrai lien prime).
  const alreadyLinked =
    (props ? hasExistingRawRef(props) : false) ||
    nodeRefs.some((r) => isRecord(r) && hasExistingRawRef(r)) ||
    (props && Array.isArray(props.refs)
      ? (props.refs as unknown[]).some((r) => isRecord(r) && hasExistingRawRef(r))
      : false);
  if (alreadyLinked) return { status: "already-linked", docSha: docSha ?? undefined };

  if (!docSha) return { status: "no-docsha" };

  // 2. Confirme l'existence réelle du PDF sur S3.
  const rawRef = await resolveRawRef(store, city, docSha);
  if (!rawRef) return { status: "no-pdf", docSha };

  // 3. Peuple le rawRef provisional partout où l'UI/le gate le lisent.
  // Citation/excerpt/page à mirorer (depuis properties ou la 1re ref).
  const src = props ?? {};
  let excerpt: string | null = null;
  for (const k of ["excerpt", "citation", "quote", "text"]) {
    if (nonEmptyString(src[k])) { excerpt = (src[k] as string).trim(); break; }
  }
  const page = typeof src.page === "number" ? src.page : undefined;

  // 3a. Patche les refs existantes (node-level + properties.refs) portant ce docSha.
  for (const r of nodeRefs) {
    if (isRecord(r) && readDocSha(r) === docSha) patchRef(r, rawRef);
  }
  if (props && Array.isArray(props.refs)) {
    for (const r of props.refs as unknown[]) {
      if (isRecord(r) && readDocSha(r) === docSha) patchRef(r, rawRef);
    }
  }

  // 3b. Garantit une ref NODE-LEVEL complète (docSha+citation+rawRef). C'est le
  //     seul chemin lu À LA FOIS par le gate #303 (props.refs) et par
  //     extractDocRefs côté UI. Indispensable pour le style "rimouski" où toute
  //     la preuve est dans properties (sans node.refs).
  const currentNodeRefs = Array.isArray(node.refs) ? (node.refs as unknown[]) : [];
  const hasCompleteNodeRef = currentNodeRefs.some(
    (r) => isRecord(r) && readDocSha(r) === docSha && hasExistingRawRef(r),
  );
  if (!hasCompleteNodeRef) {
    const ref: Record<string, unknown> = { docSha, rawRef, provisional: true, linkSource: LINK_SOURCE };
    if (excerpt) { ref.excerpt = excerpt; ref.citation = excerpt; }
    if (page !== undefined) ref.page = page;
    if (!Array.isArray(node.refs)) node.refs = [];
    (node.refs as unknown[]).push(ref);
  }

  // 3c. properties.rawRef top-level (lu par buildEvidence côté UI).
  if (props && !hasExistingRawRef(props)) {
    props.rawRef = rawRef;
    props.provisional = true;
    props.linkSource = LINK_SOURCE;
  }

  return { status: "linked", rawRef, docSha };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const cities = args.filter((a) => !a.startsWith("--"));
  const targetCities = cities.length > 0 ? cities : DEFAULT_CITIES;

  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const graphS3Config = resolveGraphS3Config(config);
  logger.info(
    { bucket: graphS3Config.bucket, endpoint: graphS3Config.endpoint, apply, cities: targetCities },
    "filet-auto-link-pv: démarrage",
  );

  const store = new S3ObjectStore(createScrapeS3Client(graphS3Config), graphS3Config.bucket);
  const { db, pool } = createDb(config);

  const outcomes: LinkOutcome[] = [];
  let citiesWritten = 0;
  let citiesReprojected = 0;
  let citiesAborted = 0;

  for (const city of targetCities) {
    const key = `graph/${city}/latest.json`;
    let graphJson: Record<string, unknown>;
    try {
      const raw = await store.get(key);
      graphJson = JSON.parse(decoder.decode(raw));
    } catch (err) {
      logger.warn({ city, key, err: String(err) }, "filet: latest.json illisible, ville ignorée");
      continue;
    }
    if (!Array.isArray(graphJson.nodes)) {
      logger.warn({ city }, "filet: pas de champ nodes, ville ignorée");
      continue;
    }

    let linkedInCity = 0;
    for (const node of graphJson.nodes as unknown[]) {
      if (!isRecord(node) || !SIGNAL_TYPES.has(String(node.type))) continue;
      const res = await linkNode(store, city, node);
      outcomes.push({ city, nodeId: String(node.id), ...res });
      if (res.status === "linked") linkedInCity++;
    }

    if (linkedInCity === 0) {
      logger.info({ city }, "filet: aucun lien à poser (déjà liés / pas de docSha / pas de PDF)");
      continue;
    }

    if (!apply) {
      logger.info({ city, linkedInCity }, "filet: DRY-RUN — liens identifiés (non écrits)");
      continue;
    }

    // Écriture S3 (source de vérité) puis reprojection PG atomique.
    const body = encoder.encode(JSON.stringify(graphJson, null, 2));
    await store.put(key, body, "application/json");
    citiesWritten++;
    logger.info({ city, linkedInCity, bytes: body.length }, "filet: latest.json mis à jour (S3)");

    const result = await upsertGraphAtomic(db, city, graphJson);
    if (result.aborted) {
      citiesAborted++;
      logger.error({ city, reason: result.reason }, "filet: REPROJECTION ABORTÉE (anormal — investiguer)");
    } else {
      citiesReprojected++;
      logger.info({ city, nodes: result.nodeCount, edges: result.edgeCount }, "filet: ville reprojetée (PG)");
    }
  }

  // Résumé.
  const linked = outcomes.filter((o) => o.status === "linked");
  const noPdf = outcomes.filter((o) => o.status === "no-pdf");
  const noDocSha = outcomes.filter((o) => o.status === "no-docsha");
  const alreadyLinked = outcomes.filter((o) => o.status === "already-linked");
  logger.info(
    {
      linked: linked.length,
      noPdf: noPdf.length,
      noDocSha: noDocSha.length,
      alreadyLinked: alreadyLinked.length,
      citiesWritten,
      citiesReprojected,
      citiesAborted,
    },
    "filet-auto-link-pv: résumé",
  );
  for (const o of linked) logger.info({ city: o.city, nodeId: o.nodeId, rawRef: o.rawRef }, "  LINKED");
  for (const o of noPdf) logger.warn({ city: o.city, nodeId: o.nodeId, docSha: o.docSha }, "  NO-PDF (non lié)");
  for (const o of noDocSha) logger.warn({ city: o.city, nodeId: o.nodeId }, "  NO-DOCSHA (non lié)");

  await pool.end();
  process.exit(citiesAborted > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("filet-auto-link-pv: fatal", err);
  process.exit(1);
});
