import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { signalMetadataFilterSchema } from "@radar/domain";
import { workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { readScopedByCity } from "../../src/services/facets/scoped-by-city.js";
import { readSignalMetadata, metadataCellsSql } from "../../src/services/facets/signal-metadata.js";
import { bumpGraphSourceRevision } from "../../src/services/facets/projection-revisions.js";
import { lockCityGraph, type GraphSignalProjectionRow } from "../../src/services/graph/graph-store.js";

it("should serve uncached unlimited metadata within one second on a representative local population", async () => {
  const f = await workspaceFixture();
  const corpus = JSON.parse(readFileSync(new URL("../fixtures/graphify/legacy-filter-a/rows.json", import.meta.url), "utf8")) as GraphSignalProjectionRow[];
  const count = 21615;
  const cities = 763;
  // Real classifier corpus, repeated across the measured preprod city/population cardinalities.
  // Synthetic identities and padding are disclosed; this is not a production data restore.
  const source = corpus.map((r) => ({ ...r, props: { ...(r.props as object),
    benchmarkEvidence: "Municipal document evidence. ".repeat(300) } }));
  await f.db.execute(sql`INSERT INTO graph_nodes(city_slug,id,type,label,props,source_ref)
    SELECT 'benchmark-'||(n % ${cities})::text,'signal-'||n::text,r.type,r.label,r.props,r."sourceRef"
    FROM generate_series(1,${count}) n CROSS JOIN LATERAL
      jsonb_to_record((${JSON.stringify(source)}::jsonb)->((n-1) % ${source.length}))
      AS r(type text,label text,props jsonb,"sourceRef" text)`);
  for (let n = 0; n < cities; n++) {
    const city = `benchmark-${n}`;
    await f.db.transaction(async (tx) => {
      await lockCityGraph(tx, city);
      await bumpGraphSourceRevision(tx, city);
    });
  }
  await f.db.execute(sql`ANALYZE signal_metadata`);
  const filter = signalMetadataFilterSchema.parse({ excludePiia: "1", excludeDerogations: "1" });
  const started = performance.now();
  const metadata = await readSignalMetadata(f.db, f.contributor.sub, f.workspaceId, filter);
  const afterMs = performance.now() - started;
  const beforeStart = performance.now();
  const legacy = await readScopedByCity(f.db, f.contributor.sub, f.workspaceId,
    { showDiscarded: false, dateRange: { excludePiia: true, excludeDerogations: true } });
  const beforeMs = performance.now() - beforeStart;
  const plan = await f.db.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    ${metadataCellsSql(f.contributor.id, f.workspaceId, filter)}`);
  for (const city of metadata.cities) {
    expect(city.facetsByClass.non_classe).toEqual(legacy.cities.find((c) => c.citySlug === city.citySlug)?.filtreCube);
  }
  console.log("SIGNAL_METADATA_BENCHMARK", JSON.stringify({ count, cities, corpusRows: source.length,
    applicationCache: "absent; first metadata call", postgresCache: "uncontrolled after projection writes",
    order: "metadata first, legacy second", beforeMs, afterMs,
    beforeBytes: Buffer.byteLength(JSON.stringify(legacy)), afterBytes: Buffer.byteLength(JSON.stringify(metadata)),
    sqlPlan: plan.rows }));
  expect(afterMs).toBeLessThanOrEqual(1000);
}, 120000);
