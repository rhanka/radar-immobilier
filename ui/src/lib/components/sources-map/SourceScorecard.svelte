<script lang="ts">
  /**
   * SourceScorecard — scorecard qualité de données d'UNE ville (D6).
   *
   * Affiche les 4 couches de la chaîne en TRI-ÉTAT honnête, avec preuve
   * (compte / version d'ontologie / servi) + fraîcheur :
   *   L1 raw      · L2 graphe · L4 zonage servi · L5 lots servis
   * Chaque ligne : badge `vérifié live` / `déclaré non substantié` / `absent`.
   * Jamais de « vert » fabriqué : la tonalité suit l'état réel de la cellule.
   *
   * Réutilisé par la carte (panneau au clic) ET la Console (ligne dépliée).
   */
  import { Badge } from "@sentropic/design-system-svelte";
  import {
    STATE_LABEL,
    STATE_BADGE_TONE,
    FRESHNESS_LABEL,
    colorForCity,
    isFocusCity,
    type CityCoverage,
  } from "$lib/sources/source-coverage-client.js";

  export let city: CityCoverage;
  /** Si fourni, affiche un bouton de fermeture (panneau latéral de carte). */
  export let onClose: (() => void) | null = null;

  $: rows = [
    {
      key: "l1",
      label: "L1 · Raw documentaire",
      cell: city.l1Raw,
      evidence:
        city.l1Raw.state === "verified"
          ? `${city.l1Raw.count} source${city.l1Raw.count !== 1 ? "s" : ""} recueillie${city.l1Raw.count !== 1 ? "s" : ""}`
          : city.l1Raw.state === "declared"
            ? "annoncé, non recueilli"
            : "rien de connu",
    },
    {
      key: "l2",
      label: "L2 · Graphe ontologie",
      cell: city.l2Graph,
      evidence:
        city.l2Graph.state === "verified"
          ? `ontologie ${city.l2Graph.ontologyVersion ?? "?"}`
          : city.l2Graph.state === "declared"
            ? "graphifié annoncé, 0 nœud en base"
            : "non graphifié",
    },
    {
      key: "l4",
      label: "L4 · Zonage servi",
      cell: city.l4Zonage,
      evidence:
        city.l4Zonage.state === "verified"
          ? "géométrie servie"
          : city.l4Zonage.state === "declared"
            ? "source connue, non servie"
            : "absent",
    },
    {
      key: "l5",
      label: "L5 · Lots servis",
      cell: city.l5Lots,
      evidence:
        city.l5Lots.state === "verified"
          ? "lots servis"
          : city.l5Lots.state === "declared"
            ? "source connue, non servie"
            : "absent",
    },
  ];
</script>

<div class="flex flex-col" data-testid="source-scorecard">
  <!-- En-tête ville -->
  <div class="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="h-3 w-3 shrink-0 rounded-sm border border-slate-300"
          style="background-color: {colorForCity(city)};"
          aria-hidden="true"
        ></span>
        <h3 class="truncate text-sm font-bold text-slate-900">{city.cityName}</h3>
        {#if isFocusCity(city)}
          <Badge tone="info" class="text-xs">Focus 30</Badge>
        {/if}
      </div>
      <p class="mt-0.5 text-xs text-slate-500">
        {city.mrc ?? "MRC inconnue"}
        {#if city.priorityRank !== null}
          <span class="text-slate-300">·</span> rang {city.priorityRank}
        {/if}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <Badge tone={STATE_BADGE_TONE[city.worstStatus]} class="text-xs">
        Pire&nbsp;: {STATE_LABEL[city.worstStatus]}
      </Badge>
      {#if onClose}
        <button
          type="button"
          class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label="Fermer"
          on:click={() => onClose?.()}
        >
          ✕
        </button>
      {/if}
    </div>
  </div>

  <!-- 4 lignes tri-état -->
  <ul class="divide-y divide-slate-100" data-testid="scorecard-rows">
    {#each rows as row (row.key)}
      <li class="flex items-center justify-between gap-3 px-4 py-2.5">
        <div class="min-w-0">
          <p class="text-xs font-semibold text-slate-700">{row.label}</p>
          <p class="text-xs text-slate-400">{row.evidence}</p>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-0.5">
          <Badge tone={STATE_BADGE_TONE[row.cell.state]} class="text-xs">
            {STATE_LABEL[row.cell.state]}
          </Badge>
          <span class="text-xs text-slate-400">
            fraîcheur&nbsp;: {FRESHNESS_LABEL[row.cell.freshness]}
          </span>
        </div>
      </li>
    {/each}
  </ul>

  <!-- Prochain gain marginal (D7) -->
  {#if city.nextMarginalGain}
    <div class="border-t border-slate-100 bg-teal-50 px-4 py-2.5">
      <p class="text-xs text-teal-800">
        <span class="font-semibold">Prochain gain marginal&nbsp;:</span>
        compléter le {city.nextMarginalGain === "zonage" ? "zonage" : "service des lots"}
        (ville graphée — complétion « cheap »).
      </p>
    </div>
  {/if}
</div>
