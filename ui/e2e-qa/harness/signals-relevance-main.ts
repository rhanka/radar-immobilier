import "../../src/app.css";
import { mount } from "svelte";
import maplibregl from "maplibre-gl";
import SignauxMapView from "$lib/components/maps/SignauxMapView.svelte";
import { workspaceContext } from "$lib/signals/workspace-client.js";

// Inspect the actual rendered map in QA, without exposing a production hook.
const addLayer = maplibregl.Map.prototype.addLayer;
maplibregl.Map.prototype.addLayer = function (...args) {
  (window as unknown as { relevanceMap: maplibregl.Map }).relevanceMap = this;
  return addLayer.apply(this, args);
};
await workspaceContext.load("relevance-fixture");
mount(SignauxMapView, { target: document.getElementById("harness-root")! });
