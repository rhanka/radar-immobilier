<script lang="ts" context="module">
  /**
   * GeoCityMapBaseStub — doublure de test du socle carto (vi.mock).
   *
   * MapLibre ne tourne pas sous jsdom : ce stub expose la MÊME surface de
   * props que GeoCityMapBase et journalise les appels à l'API impérative
   * (syncGeoLayers, fitMapToBounds, resetToInitialView…) pour que les tests
   * d'intégration de vue (SourceCoverageMap) vérifient le CONTRAT côté vue :
   * expressions passées, couches peintes, vols caméra, segments rendus.
   */
  export interface StubApiCall {
    method: string;
    args: unknown[];
  }

  export const stubCalls: StubApiCall[] = [];

  export function resetStubCalls(): void {
    stubCalls.length = 0;
  }

  export function callsOf(method: string): StubApiCall[] {
    return stubCalls.filter((c) => c.method === method);
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";

  export let fillColorExpression: unknown = undefined;
  export let fillOpacityExpression: unknown = undefined;
  export let fillOutlineColor: string = "";
  export let basemap: string = "osm";
  export let activeCitySlug: string | null = null;
  export let segments: {
    label: string;
    disabled?: boolean;
    ariaLabel?: string;
  }[] = [];
  export let activeSegment = "";
  export let onSegmentClick: (label: string) => void = () => {};
  export let onCityClick: (citySlug: string) => void = () => {};
  export let onZoneClick: (zone: { citySlug: string; code: string }) => void =
    () => {};
  export let onLotClick: (lot: {
    noLot: string;
    citySlug: string | null;
  }) => void = () => {};
  export let legend: {
    title: string;
    items: { color: string; label: string }[];
  } | null = null;
  export let selectionHighlightColor = "";
  export let onReady: (api: unknown) => void = () => {};

  function record(method: string, args: unknown[]): void {
    stubCalls.push({ method, args });
  }

  const api = {
    flyTo: (...args: unknown[]) => record("flyTo", args),
    fitMapToBounds: (...args: unknown[]) => record("fitMapToBounds", args),
    resetToInitialView: (...args: unknown[]) => {
      record("resetToInitialView", args);
      return true;
    },
    syncGeoLayers: (...args: unknown[]) => record("syncGeoLayers", args),
    getCityBoundary: () => null,
    hasCityBoundary: () => false,
    themeElement: null,
  };

  onMount(() => onReady(api));
</script>

<div
  data-testid="stub-map"
  data-basemap={basemap}
  data-outline={fillOutlineColor}
  data-highlight={selectionHighlightColor}
  data-active-city={activeCitySlug ?? ""}
  data-fill-color={JSON.stringify(fillColorExpression)}
  data-fill-opacity={JSON.stringify(fillOpacityExpression)}
>
  <div data-testid="stub-segments">
    {#each segments as segment (segment.label)}
      <button
        type="button"
        data-testid={`stub-segment-${segment.label}`}
        data-active={activeSegment === segment.label}
        disabled={segment.disabled ?? false}
        aria-label={segment.ariaLabel ?? segment.label}
        on:click={() => onSegmentClick(segment.label)}
      >
        {segment.label}
      </button>
    {/each}
  </div>
  <button
    type="button"
    data-testid="stub-city-delson"
    on:click={() => onCityClick("delson")}
  >
    click-delson
  </button>
  <button
    type="button"
    data-testid="stub-zone-h01"
    on:click={() => onZoneClick({ citySlug: "delson", code: "H-01" })}
  >
    click-zone-h01
  </button>
  <button
    type="button"
    data-testid="stub-lot"
    on:click={() => onLotClick({ noLot: "0", citySlug: null })}
  >
    click-lot
  </button>
  {#if legend}
    <div data-testid="stub-legend">{legend.title}</div>
  {/if}
  <slot name="overlay-top-left" />
  <slot name="overlay-bottom-left" />
  <slot />
</div>
