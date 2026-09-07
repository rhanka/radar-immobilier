<script lang="ts">
  /**
   * GeoCityMapBaseStub — doublure de test du socle carto (vi.mock).
   *
   * MapLibre ne tourne pas sous jsdom : ce stub remplace GeoCityMapBase dans les
   * tests d'intégration de SignauxMapView. Il expose une API impérative inerte
   * (onReady) et forwarde les slots pour que la vue monte sans WebGL. Aucune
   * assertion carte n'est faite ici : le test ne vérifie que le câblage réseau
   * (zones chargées, fetchAllLots appelé ou non).
   */
  import { onMount } from "svelte";

  export let onReady: (api: unknown) => void = () => {};
  // §5 2-modes — exposé pour les tests du switch de fond : le stub ne rejoue pas
  // l'init MapLibre mais REFLÈTE le mode reçu en attribut DOM (`data-basemap-mode`)
  // pour que la vue puisse asserter le mode RÉSOLU (défaut plan / restauration
  // satellite / coercition prod). Les autres props du socle (onBasemapFallback…)
  // sont ignorées au runtime (restProps) — inutile de les redéclarer ici.
  export let basemapMode: "plan" | "satellite" = "plan";
  // §4 R2 — le contrôle de fond (menu à UN trigger `Layers`) vit désormais dans le
  // SOCLE (ici stubé) : on REFLÈTE `showBasemapControl` en attribut DOM (host gating
  // testable au niveau vue) et on expose le writer `onBasemapModeChange` via une
  // DOUBLURE du menu (trigger + deux options radio Plan/Satellite) pour tester la
  // PERSISTANCE de `setBasemap`. L'a11y du menu NATIF réel (ouverture/clavier/ARIA)
  // est couverte dans GeoCityMapBase.basemap-mode.test.ts (socle réel).
  export let showBasemapControl = false;
  export let onBasemapModeChange: (mode: "plan" | "satellite") => void = () => {};

  const api = {
    flyTo: () => {},
    fitMapToBounds: () => {},
    resetToInitialView: () => true,
    recenterKeepZoom: () => {},
    syncGeoLayers: () => {},
    getCityBoundary: () => null,
    hasCityBoundary: () => false,
    setCptaqData: () => {},
    // §7 R2 — doublure inerte de l'emphase CPTAQ (contrat de test préservé).
    setCptaqLegendEmphasis: () => {},
    themeElement: null,
  };

  onMount(() => onReady(api));
</script>

<div
  data-testid="stub-map"
  data-basemap-mode={basemapMode}
  data-show-basemap-control={showBasemapControl}
>
  {#if showBasemapControl}
    <div data-testid="basemap-control">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label={`Fond de carte : ${basemapMode === "plan" ? "Plan" : "Satellite"}`}
        data-testid="basemap-menu-trigger"
      >
        Fond de carte
      </button>
      <div role="menu" aria-label="Fond de carte">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={basemapMode === "plan"}
          onclick={() => onBasemapModeChange("plan")}
        >
          Plan
        </button>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={basemapMode === "satellite"}
          onclick={() => onBasemapModeChange("satellite")}
        >
          Satellite
        </button>
      </div>
    </div>
  {/if}
  <slot name="overlay-top-left" />
  <slot name="overlay-bottom-left" />
  <slot />
</div>
