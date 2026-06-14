<script lang="ts">
  /**
   * CityDetailPanel — shows scrape status for all sources in one city.
   * Rendered in the right main area when the user clicks a city in the sidebar.
   */
  import { Badge, Card } from "@sentropic/design-system-svelte";
  import type { ScrapeStatusT } from "@radar/domain";
  import { maturityLabel, cityMaturityColor } from "$lib/sources/maturity.js";
  import { cityMaturity } from "@radar/domain";

  export let citySlug: string;
  export let items: ScrapeStatusT[];

  $: maturity = cityMaturity(items);
  $: color = cityMaturityColor(maturity);
  $: label = maturityLabel(maturity);

  const SOURCE_LABELS: Record<string, string> = {
    "conseils-municipaux": "Conseils municipaux",
    "avis-publics": "Avis publics",
    "youtube-seances": "Séances YouTube",
    "zonage": "Zonage",
    "role-evaluation": "Rôle d'évaluation",
  };

  const STATUS_TONE: Record<
    string,
    "success" | "error" | "warning" | "info" | "neutral"
  > = {
    graphified: "success",
    scraped: "info",
    identified: "warning",
    todo: "neutral",
    error: "error",
  };

  const STATUS_LABELS: Record<string, string> = {
    graphified: "Graphifié",
    scraped: "Scrapé",
    identified: "Identifié",
    todo: "À faire",
    error: "Erreur",
  };

  const COLOR_TEXT: Record<string, string> = {
    green: "text-green-700",
    teal: "text-teal-700",
    amber: "text-amber-700",
    red: "text-red-700",
    slate: "text-slate-400",
  };
</script>

<div class="flex flex-col gap-4 p-6">
  <div>
    <h2 class="text-lg font-semibold capitalize text-slate-900">{citySlug}</h2>
    <p class={`mt-0.5 text-sm font-medium ${COLOR_TEXT[color]}`}>
      {label} — {maturity}%
    </p>
  </div>

  {#if items.length === 0}
    <p class="text-sm text-slate-400">Aucun statut enregistré pour cette ville.</p>
  {:else}
    <ul class="space-y-3">
      {#each items as item (item.source)}
        <li>
          <Card>
          <div class="p-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-slate-800">
              {SOURCE_LABELS[item.source] ?? item.source}
            </span>
            <Badge tone={STATUS_TONE[item.status] ?? "neutral"}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Badge>
          </div>
          {#if item.siteUrl}
            <a
              href={item.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1 block truncate text-xs text-teal-600 hover:underline"
            >
              {item.siteUrl}
            </a>
          {/if}
          {#if item.coveragePct !== undefined}
            <div class="mt-2">
              <div class="flex items-center justify-between text-xs text-slate-500">
                <span>Couverture</span>
                <span>{item.coveragePct}%</span>
              </div>
              <div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  class="h-full rounded-full bg-teal-500 transition-all"
                  style={`width: ${item.coveragePct}%`}
                ></div>
              </div>
            </div>
          {/if}
          {#if item.dataQuality && item.dataQuality !== "none"}
            <p class="mt-1 text-xs text-slate-400">
              Format : <span class="font-mono"
                >{item.dataQuality.toUpperCase()}</span
              >
            </p>
          {/if}
          {#if item.notes}
            <p class="mt-1 text-xs italic text-slate-500">{item.notes}</p>
          {/if}
          {#if item.lastRunAt}
            <p class="mt-1 text-xs text-slate-400">
              Dernier run : {new Date(item.lastRunAt).toLocaleDateString("fr-CA")}
            </p>
          {/if}
          </div>
          </Card>
        </li>
      {/each}
    </ul>
  {/if}
</div>
