import { ensureMaplibreWorker } from "@sentropic/geo-ui-svelte";

/** Bundle the worker's shared imports before any application map mounts. */
export async function initializeMaplibreWorker(): Promise<void> {
  await ensureMaplibreWorker(
    await import("maplibre-gl"),
    async () => (await import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url")).default,
  );
}
