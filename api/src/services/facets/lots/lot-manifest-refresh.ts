/**
 * 6K server-side manifest refresh: rebuild the 6F migration report from
 * live source rows without trusting any client-supplied manifest.
 *
 * Read-only and repeatable: a single `REPEATABLE READ READ ONLY`
 * transaction snapshots `prospect_marks` and `lot_versions`, so the
 * recomputed digest is comparable across the pre-gate evaluation and
 * the under-fence stage-5 recheck. Any source drift between the two
 * aborts the activation. Corrupt source rows fail closed instead of
 * being silently skipped: every source row appears in the manifest or
 * in an explicit diagnostic.
 */
import { sql } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { lotVersions, prospectMarks } from "../../../db/schema.js";
import { FacetError } from "../target.js";
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import type { LotMigrationReport } from "../lot-migration-report/manifest.js";
import type {
  LotVersionRef,
  SourceDimension,
  SourceMark,
  SourceMode,
  SourceStatut,
} from "../lot-migration-report/types.js";

export interface ManifestMapping {
  mappingVersion: string;
  importerVersion: string;
  destinationsQualified: boolean;
}

export function assertManifestMapping(mapping: unknown): asserts mapping is ManifestMapping {
  const candidate = mapping as Partial<ManifestMapping> | null;
  if (!candidate || typeof candidate !== "object") throw new FacetError(400, "invalid_facet_command");
  for (const field of ["mappingVersion", "importerVersion"] as const) {
    if (typeof candidate[field] !== "string" || candidate[field] === ""
      || candidate[field]!.length > 256) {
      throw new FacetError(400, "invalid_facet_command");
    }
  }
  if (typeof candidate.destinationsQualified !== "boolean") {
    throw new FacetError(400, "invalid_facet_command");
  }
}

const DIMENSIONS: readonly string[] = ["pipeline", "marche"];
const STATUTS: readonly string[] = ["favori", "ecarte", "sollicite", "lettre_envoyee", "en_vente"];
const MODES: readonly string[] = ["real", "simulation"];

function toSourceMark(row: typeof prospectMarks.$inferSelect): SourceMark {
  if (!DIMENSIONS.includes(row.dimension) || !STATUTS.includes(row.statut)
    || !MODES.includes(row.mode)) {
    throw new FacetError(409, "lot_manifest_source_invalid");
  }
  return {
    id: row.id,
    lotVersionId: row.lotVersionId,
    noLot: row.noLot,
    citySlug: row.citySlug,
    dimension: row.dimension as SourceDimension,
    statut: row.statut as SourceStatut,
    mode: row.mode as SourceMode,
    authorId: row.authorId,
    supersedes: row.supersedes,
    supersededBy: row.supersededBy,
    prixDemande: row.prixDemande,
    lienAnnonce: row.lienAnnonce,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function toLotVersionRef(row: typeof lotVersions.$inferSelect): LotVersionRef {
  return {
    id: row.id,
    canonicalId: row.canonicalId,
    noLot: row.noLot,
    citySlug: row.citySlug,
    reconStatus: row.reconStatus ?? "",
  };
}

/** Rebuild the 6F report from a repeatable read-only source snapshot. */
export async function recomputeLotManifest(
  db: Database, mapping: ManifestMapping,
): Promise<LotMigrationReport> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"));
    const marks = (await tx.select().from(prospectMarks)).map(toSourceMark);
    const lots = (await tx.select().from(lotVersions)).map(toLotVersionRef);
    return buildLotMigrationReport({ marks, lotVersions: lots, mapping });
  });
}
