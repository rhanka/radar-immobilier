import "../../src/app.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { mount } from "svelte";
import { initializeMaplibreWorker } from "$lib/maps/maplibre-worker.js";
import Harness from "./MaplibreSecurityHarness.svelte";

async function bootstrap(): Promise<void> {
  const target = document.getElementById("harness-root");
  if (!target) throw new Error("Missing #harness-root");
  await initializeMaplibreWorker();
  mount(Harness, { target });
}
void bootstrap().catch((error: unknown) => {
  console.error(error);
  document.body.dataset.bootstrapError = String(error);
});
