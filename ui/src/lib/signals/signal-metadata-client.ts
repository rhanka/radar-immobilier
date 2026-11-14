import { mergeVivierFiltreCubes, type SignalMetadataResponse } from "@radar/domain";
import { fetchJsonWithTimeout, DEFAULT_REQUEST_TIMEOUT_MS, readJsonErrorCode } from "$lib/net/fetch-with-timeout.js";
import { GraphSignalsHttpError, scopedSignalFacetsPath, type SignalScope } from "./graph-signal-detail-client.js";
import type { GraphSignalCityItem, GraphSignalsByCityOptions } from "./graph-signals-by-city-client.js";

/** Explicitly versioned read. Unsupported servers fail visibly, without a card fallback. */
export async function fetchSignalMetadata(scope: SignalScope, options: GraphSignalsByCityOptions = {}) {
  const params = new URLSearchParams({ contract: "metadata-v2", scope: "quebec" });
  if (options.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options.dateTo) params.set("dateTo", options.dateTo);
  if (options.dateBasis === "scrap") params.set("dateBasis", "scrap");
  if (options.excludePiia) params.set("excludePiia", "1");
  if (options.excludeDerogations) params.set("excludeDerogations", "1");
  const result = await fetchJsonWithTimeout<SignalMetadataResponse>(scopedSignalFacetsPath(scope, `by-city?${params}`), {
    signal: options.signal, timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });
  if (!result.ok) throw new GraphSignalsHttpError(`metadata-v2: ${result.status}`, result.status, readJsonErrorCode(result.json));
  if (result.json?.contract !== "metadata-v2") throw new GraphSignalsHttpError("metadata-v2: unsupported response", 502, null);
  return result.json;
}

/** Keep the local filter lens over bounded SQL cells at the map boundary. */
export function metadataCityItems(metadata: SignalMetadataResponse): GraphSignalCityItem[] {
  return metadata.cities.map((city) => {
    const cubes = city.facetsByClass;
    const visible = mergeVivierFiltreCubes([cubes.pertinent, cubes.a_surveiller, cubes.non_classe]);
    return { citySlug: city.citySlug, signalCount: Object.values(visible).reduce((a, b) => a + b, 0),
      subsetCounts: {}, filtreCube: visible, filtreCubesByClassement: cubes };
  });
}
