import { createHash } from "node:crypto";
import {
  archiveCityGraphPrefix,
  canonicalMatchesBody,
  type CanonicalArchiveReceipt,
  type CanonicalGraphStore,
  CANONICAL_BACKUP_ROOT,
  readCityGraphArchive,
  verifyCityGraphArchive,
  writeCanonicalCityGraph,
} from "./canonical-graph-writer.js";
import {
  type GraphifyGraph,
  type GraphifyLink,
  type GraphifyNode,
  type Subgraph,
} from "./graph-store.js";
import {
  GRAPHIFY34_ONTOLOGY_VERSION,
  GRAPHIFY34_PASS,
  type Graphify34Snapshot,
} from "./graphify-34-enrichment.js";

export interface Graphify34Manifest {
  municipality: string;
  graphify_pass: typeof GRAPHIFY34_PASS;
  ontology_version: typeof GRAPHIFY34_ONTOLOGY_VERSION;
  snapshot_key: string;
  snapshot_mode: "complete-city";
  source: "graph_nodes";
  node_count: number;
  edge_count: number;
}

/** The store surface phase A needs: the guarded canonical writer's, unchanged. */
export type Graphify34SnapshotStore = CanonicalGraphStore;

export interface Graphify34SnapshotTarget {
  municipality: string;
  snapshot: Graphify34Snapshot;
  manifest: Graphify34Manifest;
}

/** Written once, before the first canonical byte, so a run can be resumed. */
export interface Graphify34ApplyPlan {
  backup_id: string;
  created_at: string;
  cities: string[];
}

/** Written after a city is fully applied (canonical + manifest + projection). */
export interface Graphify34AppliedMarker {
  city: string;
  applied_at: string;
  snapshot_sha256: string;
  backup_prefix: string;
}

export interface Graphify34ApplyReport {
  backup_id: string;
  archives: CanonicalArchiveReceipt[];
  applied: string[];
  skipped_already_applied: string[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sortedRecord(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function nodeFromDb(row: Subgraph["nodes"][number]): GraphifyNode {
  const stored = record(row.props);
  const properties = record(stored.properties);
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    ...(row.sourceRef !== null ? { source_file: row.sourceRef } : {}),
    ...(stored.community !== undefined ? { community: Number(stored.community) } : {}),
    ...(stringValue(stored.community_name) !== null
      ? { community_name: stringValue(stored.community_name)! }
      : {}),
    ...(stringValue(stored.status) !== null ? { status: stringValue(stored.status)! } : {}),
    ...(stringValue(stored.description) !== null
      ? { description: stringValue(stored.description)! }
      : {}),
    ...(Array.isArray(stored.refs) ? { refs: stored.refs as GraphifyNode["refs"] } : {}),
    properties: sortedRecord(properties),
  };
}

function edgeFromDb(row: Subgraph["edges"][number]): GraphifyLink {
  const stored = record(row.props);
  return {
    source: row.srcId,
    target: row.dstId,
    type: row.kind,
    ...(typeof stored.confidence === "string" ? { confidence: stored.confidence } : {}),
    ...(typeof stored.confidence_score === "number"
      ? { confidence_score: stored.confidence_score }
      : {}),
    ...(typeof stored.source_file === "string" ? { source_file: stored.source_file } : {}),
    ...(Array.isArray(stored.refs) ? { refs: stored.refs as GraphifyLink["refs"] } : {}),
    properties: sortedRecord(record(stored.properties)),
  };
}

/** Build the complete city snapshot from the existing graph projection. */
export function snapshotFromExistingCity(subgraph: Subgraph): GraphifyGraph {
  return {
    nodes: subgraph.nodes.map(nodeFromDb).sort((left, right) => left.id.localeCompare(right.id)),
    edges: subgraph.edges
      .map(edgeFromDb)
      .sort((left, right) => {
        const leftKey = `${left.source}\u0000${left.target}\u0000${left.type ?? left.relation ?? ""}`;
        const rightKey = `${right.source}\u0000${right.target}\u0000${right.type ?? right.relation ?? ""}`;
        return leftKey.localeCompare(rightKey);
      }),
  };
}

export function buildGraphify34Manifest(
  municipality: string,
  snapshot: Graphify34Snapshot,
): Graphify34Manifest {
  return {
    municipality,
    graphify_pass: GRAPHIFY34_PASS,
    ontology_version: GRAPHIFY34_ONTOLOGY_VERSION,
    snapshot_key: `graph/${municipality}/latest.json`,
    snapshot_mode: "complete-city",
    source: "graph_nodes",
    node_count: snapshot.nodes.length,
    edge_count: (snapshot.edges ?? []).length + (snapshot.links ?? []).length,
  };
}

export function applyPlanKey(backupId: string): string {
  return `${CANONICAL_BACKUP_ROOT}/${backupId}/_apply-plan.json`;
}

export function appliedMarkerKey(backupId: string, municipality: string): string {
  return `${CANONICAL_BACKUP_ROOT}/${backupId}/_applied/${municipality}.json`;
}

/**
 * Interruption report. S3 gives no multi-key transaction, so phase A does not
 * claim atomicity — it claims RESUMABILITY: every city that completed left an
 * `_applied/<city>.json` marker, so `--resume` picks up exactly where the run
 * stopped, and this error names the one city that may be half-written along
 * with the archive prefix to restore it from.
 */
export class Graphify34ApplyInterrupted extends Error {
  readonly backupId: string;
  readonly applied: string[];
  readonly interruptedCity: string | null;
  readonly restoreFrom: string | null;
  readonly stage: string;

  constructor(params: {
    backupId: string;
    applied: string[];
    interruptedCity: string | null;
    restoreFrom: string | null;
    stage: string;
    remaining: string[];
    cause: unknown;
  }) {
    const restore = params.interruptedCity === null
      ? "no city was mid-write"
      : `${params.interruptedCity} stopped at stage "${params.stage}" — restore it by copying ` +
        `${params.restoreFrom} back over graph/${params.interruptedCity}/ ` +
        "(only needed for a stage at or after canonical-write)";
    super(
      `graphify-3.4 apply interrupted (backup ${params.backupId}): ${String(params.cause)}\n` +
        `  fully applied : ${params.applied.join(", ") || "none"}\n` +
        `  interrupted   : ${restore}\n` +
        `  not started   : ${params.remaining.join(", ") || "none"}\n` +
        `  resume with   : --apply --backup-id=${params.backupId} --resume ` +
        `${[...(params.interruptedCity ? [params.interruptedCity] : []), ...params.remaining].join(" ")}`,
      { cause: params.cause },
    );
    this.name = "Graphify34ApplyInterrupted";
    this.backupId = params.backupId;
    this.applied = params.applied;
    this.interruptedCity = params.interruptedCity;
    this.restoreFrom = params.restoreFrom;
    this.stage = params.stage;
  }
}

async function readAppliedMarker(
  store: Graphify34SnapshotStore,
  backupId: string,
  municipality: string,
): Promise<Graphify34AppliedMarker | null> {
  const key = appliedMarkerKey(backupId, municipality);
  if ((await store.head(key)) === null) return null;
  return JSON.parse(decoder.decode(await store.get(key))) as Graphify34AppliedMarker;
}

/**
 * Apply phase A.
 *
 * Fail closed and in this order:
 *   1. every target city's `graph/<city>/` prefix is archived, with a per-object
 *      sha256 and a digest over the inventory, BEFORE any canonical byte moves;
 *   2. an apply plan is published so an interrupted run can be resumed;
 *   3. each city is published through the guarded canonical writer, which
 *      refuses if the object moved since it was archived, then projected, then
 *      marked applied.
 *
 * A fresh `backupId` refuses to touch an archive that already exists (an
 * archive is never silently overwritten). `resume: true` reuses the existing
 * archive after verifying it object by object, and skips the cities already
 * marked applied.
 */
export async function applyGraphify34Snapshots(
  store: Graphify34SnapshotStore,
  targets: readonly Graphify34SnapshotTarget[],
  backupId: string,
  project: (target: Graphify34SnapshotTarget) => Promise<void>,
  options: { resume?: boolean; now?: () => Date } = {},
): Promise<Graphify34ApplyReport> {
  const now = options.now ?? (() => new Date());
  const planKey = applyPlanKey(backupId);
  const planExists = (await store.head(planKey)) !== null;

  if (!options.resume && planExists) {
    throw new Error(
      `apply plan ${planKey} already exists: backup id ${backupId} was already used. ` +
        "Use a fresh --backup-id, or --resume to continue that run.",
    );
  }
  if (options.resume && !planExists) {
    throw new Error(
      `cannot resume: no apply plan at ${planKey}. A resume must point at the backup id ` +
        "of the interrupted run.",
    );
  }

  const archives: CanonicalArchiveReceipt[] = [];
  const alreadyApplied: string[] = [];

  for (const target of targets) {
    if (options.resume) {
      const existing = await readCityGraphArchive(store, target.municipality, backupId);
      if (existing === null) {
        throw new Error(
          `cannot resume ${target.municipality}: no archive under backup id ${backupId}. ` +
            "That city was never archived, so there is nothing to fall back to.",
        );
      }
      await verifyCityGraphArchive(store, existing);
      archives.push(existing);
      if ((await readAppliedMarker(store, backupId, target.municipality)) !== null) {
        alreadyApplied.push(target.municipality);
      }
    } else {
      archives.push(await archiveCityGraphPrefix(store, target.municipality, backupId, now));
    }
  }

  if (!planExists) {
    const plan: Graphify34ApplyPlan = {
      backup_id: backupId,
      created_at: now().toISOString(),
      cities: targets.map((target) => target.municipality),
    };
    await store.put(planKey, encoder.encode(JSON.stringify(plan, null, 2)), "application/json");
  }

  const archiveByCity = new Map(archives.map((archive) => [archive.city, archive]));
  const pending = targets.filter((target) => !alreadyApplied.includes(target.municipality));
  const applied: string[] = [];

  for (let index = 0; index < pending.length; index++) {
    const target = pending[index]!;
    const archive = archiveByCity.get(target.municipality)!;
    const body = encoder.encode(JSON.stringify(target.snapshot));
    const remaining = pending.slice(index + 1).map((next) => next.municipality);
    let stage = "canonical-write";
    try {
      // A resumed run may have been interrupted AFTER its canonical PUT but
      // before the applied marker. The published bytes are then already ours,
      // and the archived ETag no longer matches — re-publishing is neither
      // needed nor allowed. Identity of content, not a marker, decides.
      const alreadyPublished = options.resume
        && await canonicalMatchesBody(store, target.municipality, body);
      if (!alreadyPublished) {
        await writeCanonicalCityGraph(store, {
          citySlug: target.municipality,
          body,
          archive,
        });
      }
      stage = "manifest-write";
      await store.put(
        `graph/${target.municipality}/graphify-3.4.manifest.json`,
        encoder.encode(JSON.stringify(target.manifest)),
        "application/json",
      );
      stage = "projection";
      await project(target);
      stage = "applied-marker";
      const marker: Graphify34AppliedMarker = {
        city: target.municipality,
        applied_at: now().toISOString(),
        snapshot_sha256: createHash("sha256").update(body).digest("hex"),
        backup_prefix: archive.backup_prefix,
      };
      await store.put(
        appliedMarkerKey(backupId, target.municipality),
        encoder.encode(JSON.stringify(marker, null, 2)),
        "application/json",
      );
      applied.push(target.municipality);
    } catch (cause) {
      throw new Graphify34ApplyInterrupted({
        backupId,
        applied,
        interruptedCity: target.municipality,
        restoreFrom: archive.backup_prefix,
        stage,
        remaining,
        cause,
      });
    }
  }

  return {
    backup_id: backupId,
    archives,
    applied,
    skipped_already_applied: alreadyApplied,
  };
}
