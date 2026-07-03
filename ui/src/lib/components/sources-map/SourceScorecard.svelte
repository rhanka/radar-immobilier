<script lang="ts">
  /**
   * SourceScorecard — scorecard qualité de données d'UNE ville (D6).
   *
   * Une ligne par COUCHE RÉELLE, en tri-état avec preuve + fraîcheur, dans
   * l'ordre : PV collectés · Signaux extraits (+ part avec citation
   * vérifiable) · Zones servies · Normes (grilles) · Lots (cadastre) ·
   * Périmètres TOD. Chaque ligne : badge « Servi » / « Partiel » /
   * « Non couvert » (copy client neutre). Jamais de « vert » fabriqué : la
   * tonalité suit l'état réel.
   *
   * La ligne « Normes (grilles) » est mesurée LAZY (live, côté API) à la
   * sélection de la ville : donnée éparse aujourd'hui, « Non couvert » honnête
   * quand absente, « donnée indisponible » (jamais un faux gris) quand l'API
   * géo est injoignable. TOD vient du listing live géo (`qc-tod-<slug>`).
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
    fetchCityGrilles,
    type CityCoverage,
    type CityGrilles,
  } from "$lib/sources/source-coverage-client.js";

  export let city: CityCoverage;
  /** Si fourni, affiche un bouton de fermeture (panneau latéral de carte). */
  export let onClose: (() => void) | null = null;

  // ── Grilles de zonage : vérification lazy à la sélection ───────────────────
  let grilles: CityGrilles | null = null;
  let grillesLoading = false;
  let grillesError = false;
  let grillesForSlug = "";

  $: void loadGrilles(city);

  async function loadGrilles(c: CityCoverage): Promise<void> {
    if (grillesForSlug === c.citySlug) return;
    grillesForSlug = c.citySlug;
    grilles = null;
    grillesError = false;
    // Zonage non servi → pas de zones → pas de grilles : aucun appel réseau.
    if (!c.l4Zonage.served) return;
    grillesLoading = true;
    try {
      const result = await fetchCityGrilles(c.citySlug);
      if (grillesForSlug === c.citySlug) grilles = result;
    } catch {
      if (grillesForSlug === c.citySlug) grillesError = true;
    } finally {
      if (grillesForSlug === c.citySlug) grillesLoading = false;
    }
  }

  function geoEvidence(
    cell: CityCoverage["l4Zonage"],
    servedLabel: string,
  ): string {
    if (cell.state === "verified") {
      return cell.servedBy === "geo"
        ? `${servedLabel} par l'API géo`
        : `${servedLabel} (données locales)`;
    }
    if (cell.state === "declared") return "source identifiée, non publiée";
    return "aucune donnée";
  }

  $: rows = [
    {
      key: "pv",
      label: "PV collectés",
      cell: city.l1Raw,
      evidence:
        city.l1Raw.state === "verified"
          ? `${city.l1Raw.count} document${city.l1Raw.count !== 1 ? "s" : ""} collecté${city.l1Raw.count !== 1 ? "s" : ""}`
          : city.l1Raw.state === "declared"
            ? "source identifiée, non collectée"
            : "aucune donnée",
    },
    {
      key: "signaux",
      label: "Signaux extraits",
      cell: city.signals,
      evidence:
        city.signals.state === "verified"
          ? `${city.signals.count} signal${city.signals.count !== 1 ? "aux" : ""} · ${city.signals.withCitation} avec citation vérifiable`
          : city.signals.state === "declared"
            ? "données structurées, signaux non projetés"
            : "aucun signal extrait",
    },
    {
      key: "zones",
      label: "Zones servies",
      cell: city.l4Zonage,
      evidence: geoEvidence(city.l4Zonage, "zones servies"),
    },
    {
      key: "lots",
      label: "Lots (cadastre)",
      cell: city.l5Lots,
      evidence: geoEvidence(city.l5Lots, "lots servis"),
    },
    {
      key: "tod",
      label: "Périmètres TOD",
      cell: city.tod,
      evidence: geoEvidence(city.tod, "périmètres TOD servis"),
    },
  ];

  // Évidence + libellé de la ligne grilles (états async distincts, honnêtes).
  $: grillesResolved = grilles !== null && grilles.available;
  $: grillesState =
    grillesResolved && grilles?.state ? grilles.state : null;
  $: grillesEvidence = !city.l4Zonage.served
    ? "aucune donnée"
    : grillesLoading
      ? "vérification en cours…"
      : grillesError || (grilles !== null && !grilles.available)
        ? "donnée indisponible pour l'instant"
        : grillesResolved && grilles
          ? (grilles.covered ?? 0) > 0
            ? `${grilles.covered}/${grilles.zoneCount} zones avec grille ou normes`
            : "aucune grille publiée"
          : "vérification en cours…";
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
        Couverture&nbsp;: {STATE_LABEL[city.worstStatus]}
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

  <!-- Chaîne qualité tri-état -->
  <ul class="divide-y divide-slate-100" data-testid="scorecard-rows">
    {#each rows as row (row.key)}
      {#if row.key === "lots"}
        <!-- Normes (grilles) : ligne LAZY (live), insérée entre zones et lots -->
        <li
          class="flex items-center justify-between gap-3 px-4 py-2.5"
          data-testid="scorecard-grilles"
        >
          <div class="min-w-0">
            <p class="text-xs font-semibold text-slate-700">Normes (grilles)</p>
            <p class="text-xs text-slate-400">{grillesEvidence}</p>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-0.5">
            {#if grillesState}
              <Badge tone={STATE_BADGE_TONE[grillesState]} class="text-xs">
                {STATE_LABEL[grillesState]}
              </Badge>
              <span class="text-xs text-slate-400">fraîcheur&nbsp;: à jour</span>
            {:else if !city.l4Zonage.served}
              <Badge tone="neutral" class="text-xs">{STATE_LABEL.absent}</Badge>
              <span class="text-xs text-slate-400">fraîcheur&nbsp;: —</span>
            {:else}
              <Badge tone="neutral" class="text-xs">—</Badge>
              <span class="text-xs text-slate-400">fraîcheur&nbsp;: —</span>
            {/if}
          </div>
        </li>
      {/if}
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

  <!-- Prochaine étape (D7) -->
  {#if city.nextMarginalGain}
    <div class="border-t border-slate-100 bg-teal-50 px-4 py-2.5">
      <p class="text-xs text-teal-800">
        <span class="font-semibold">Prochaine étape&nbsp;:</span>
        compléter le {city.nextMarginalGain === "zonage" ? "zonage" : "cadastre"}
        (donnée déjà structurée).
      </p>
    </div>
  {:else if city.l4Zonage.served && grillesState && grillesState !== "verified"}
    <div class="border-t border-slate-100 bg-teal-50 px-4 py-2.5">
      <p class="text-xs text-teal-800">
        <span class="font-semibold">Prochaine étape&nbsp;:</span>
        compléter les grilles de zonage (donnée attendue de la source géo).
      </p>
    </div>
  {/if}
</div>
