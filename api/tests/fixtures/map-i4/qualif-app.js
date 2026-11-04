/**
 * Qualification page driver (I-4 test fixture).
 *
 * Loads the pinned map base by reference (kit URL carried on the container
 * dataset, never inlined), feeds it the two GeoJSON sources served
 * same-origin (as reader operations would), paints through page-supplied
 * expressions, and exposes a deterministic hook for the headless
 * qualification check.
 */

const container = document.getElementById("map");
const status = document.getElementById("map-status");
const factZones = document.getElementById("fact-zones");
const factLots = document.getElementById("fact-lots");
const factSelection = document.getElementById("fact-selection");

function describe(feature) {
  if (!feature || typeof feature !== "object") return "aucune";
  const properties = feature.properties ?? {};
  const zone = properties.zone_code ?? properties.num_zone ?? "?";
  const lot = properties.NO_LOT ?? properties.noLot ?? properties.lot_id ?? "?";
  return `lot ${lot} · zone ${zone}`;
}

async function boot() {
  const moduleUrl = container.dataset.mapModule;
  const { createMap } = await import(moduleUrl);
  const map = createMap(container, { basemapTemplate: null });
  const [zonesResponse, lotsResponse] = await Promise.all([
    fetch(container.dataset.zones),
    fetch(container.dataset.lots),
  ]);
  const zones = await zonesResponse.json();
  const lots = await lotsResponse.json();
  map.setZones(zones);
  map.setLots(lots);
  const zoneColorOf = (code) => {
    if (typeof code !== "string") return "#9db89a";
    if (code.startsWith("C")) return "#d9a441";
    if (code.startsWith("H")) return "#7fa8c9";
    return "#9db89a";
  };
  map.setPaint({
    zones: {
      fill: (properties) => zoneColorOf(properties.zone_code),
      stroke: "#2f2f2f",
      lineWidth: 1,
    },
    lots: {
      fill: (properties) => (Number(properties.surface_m2) > 1000 ? "#4c8c4a" : "#b9d3b8"),
      stroke: "#2f2f2f",
      lineWidth: 1,
    },
  });
  map.fitToBounds();
  map.on("hover", (event) => {
    window.__mapQualif.lastHover = {
      layer: event.layer,
      index: event.index,
      zoneCode: event.feature?.properties?.zone_code ?? null,
      lotId: event.feature?.properties?.NO_LOT ?? event.feature?.properties?.noLot ?? null,
    };
  });
  map.on("click", (event) => {
    window.__mapQualif.lastClick = {
      layer: event.layer,
      index: event.index,
      lon: event.lon,
      lat: event.lat,
      describe: event.feature ? describe(event.feature) : "aucune",
      zoneCode: event.feature?.properties?.zone_code ?? null,
      lotId: event.feature?.properties?.NO_LOT ?? event.feature?.properties?.noLot ?? null,
    };
    factSelection.textContent = window.__mapQualif.lastClick.describe;
  });
  factZones.textContent = String(map.getFeatureCounts().zones);
  factLots.textContent = String(map.getFeatureCounts().lots);
  status.textContent = "Carte prête.";
  window.__mapQualif.ready = true;
  window.__mapQualif.map = map;
}

window.__mapQualif = { ready: false, map: null, lastClick: null, lastHover: null };
boot().catch((error) => {
  status.textContent = `Échec du chargement : ${error instanceof Error ? error.message : String(error)}`;
});
