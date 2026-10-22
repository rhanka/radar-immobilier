/**
 * 6K cutover route-test harness: shared synthetic seeding and app wiring.
 * No operational data.
 */
import { Hono } from "hono";
import { prospectMarksRoute } from "./prospect-marks.js";
import { scopedLotCutoverRoute } from "./scoped-lot-cutover.js";
import { scopedLotCutoverActivationRoute } from "./scoped-lot-cutover-activation.js";
import { scopedLotFacetsRoute } from "./scoped-lot-facets.js";
import type { CutoverFixture } from "../services/facets/lots/cutover-fixture.js";
import { recordingCutoverSafety } from "../services/facets/lots/cutover-fixture.js";

export const MAPPING = { mappingVersion: "syn-6k-route-v1", importerVersion: "syn-6k-route-i1",
  destinationsQualified: true };

export const LEGACY_CHAIN = [
  { id: "7c000000-0000-4000-8000-000000000001", statut: "favori",
    supersedes: null, supersededBy: "7c000000-0000-4000-8000-000000000002",
    created: "2026-03-01T10:00:00.000Z" },
  { id: "7c000000-0000-4000-8000-000000000002", statut: "sollicite",
    supersedes: "7c000000-0000-4000-8000-000000000001",
    supersededBy: "7c000000-0000-4000-8000-000000000003",
    created: "2026-03-02T10:00:00.000Z" },
  { id: "7c000000-0000-4000-8000-000000000003", statut: "ecarte",
    supersedes: "7c000000-0000-4000-8000-000000000002", supersededBy: null,
    created: "2026-03-03T10:00:00.000Z" },
] as const;

export async function seedLegacyChain(f: CutoverFixture, authorId: string): Promise<void> {
  const params = LEGACY_CHAIN.flatMap((mark) =>
    [mark.id, mark.statut, authorId, mark.supersedes, mark.supersededBy, mark.created]);
  const values = LEGACY_CHAIN.map((_, index) => {
    const n = index * 6;
    return `($${n + 1}, '6a000000-0000-4000-8000-0000000000aa', 'SYN-6J-0001', 'synthetic-6j-city',
      'pipeline', $${n + 2}, 'real', $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}::timestamptz)`;
  });
  await f.pool.query(`INSERT INTO prospect_marks
      (id, lot_version_id, no_lot, city_slug, dimension, statut, mode, author_id,
       supersedes, superseded_by, created_at)
      VALUES ${values.join(",")}`, params);
  await f.pool.query(`INSERT INTO prospect_marks
    (id, lot_version_id, no_lot, city_slug, dimension, statut, mode, author_id,
     prix_demande, lien_annonce, created_at)
    VALUES ('7c000000-0000-4000-8000-000000000004',
      '6a000000-0000-4000-8000-0000000000bb', 'SYN-6J-0002', 'synthetic-6j-city',
      'marche', 'en_vente', 'real', $1, '250000.00',
      'https://synthetic.invalid/annonce/6k-route', '2026-03-04T10:00:00.000Z')`,
  [authorId]);
}

export function makeCutoverApp(
  f: CutoverFixture, session: { sub: string; via?: string } | null,
): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
  app.route("/", prospectMarksRoute({ db: f.db as never }));
  const cutoverMapping = { workspaceId: f.workspaceId, mapping: MAPPING };
  app.route("/", scopedLotCutoverRoute({ db: f.db as never, auth: { enabled: true }, cutoverMapping }));
  app.route("/", scopedLotCutoverActivationRoute({ db: f.db as never, auth: { enabled: true },
    cutoverSafety: recordingCutoverSafety().safety, cutoverMapping }));
  app.route("/", scopedLotFacetsRoute({ db: f.db as never, auth: { enabled: true }, requireCutover: true }));
  return app;
}
