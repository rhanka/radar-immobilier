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
  import { onMount } from "svelte";
  import { Badge } from "@sentropic/design-system-svelte";
  import {
    STATE_LABEL,
    STATE_BADGE_TONE,
    FRESHNESS_LABEL,
    colorForCity,
    isFocusCity,
    fetchCityGrilles,
    fetchCityLotFields,
    lotFieldEvidence,
    lotFieldsMethodNote,
    type CityCoverage,
    type CityGrilles,
    type CityLotFields,
    type FocusScope,
  } from "$lib/sources/source-coverage-client.js";
  import {
    fetchSourceConsistency,
    getCityConsistency,
    formatEdgeCount,
    formatReliablePct,
    formatConsistencyFreshness,
    CONSISTENCY_STATE_LABEL,
    CONSISTENCY_STATE_BADGE_TONE,
    type ConsistencyResponse,
  } from "$lib/sources/source-consistency-client.js";

  export let city: CityCoverage;
  /**
   * Périmètre focus (villes à signaux PRIORITAIRES z∩m∩p — zonage ∩
   * multifamilial 4+ ∩ précoce) calculé par le parent depuis la couverture
   * complète (`computeFocusScope`). Null = badge focus masqué (le scorecard
   * seul ne décide pas — le périmètre est calculé une fois au niveau liste).
   */
  export let focusScope: FocusScope | null = null;
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

  // ── Champs lot enrichis (superficie/adresse/CP/normes) : lazy aussi ────────
  let lotFields: CityLotFields | null = null;
  let lotFieldsLoading = false;
  let lotFieldsError = false;
  let lotFieldsForSlug = "";

  $: void loadLotFields(city);

  async function loadLotFields(c: CityCoverage): Promise<void> {
    if (lotFieldsForSlug === c.citySlug) return;
    lotFieldsForSlug = c.citySlug;
    lotFields = null;
    lotFieldsError = false;
    // Lots non servis → pas de champs lot : aucun appel réseau.
    if (!c.l5Lots.served) return;
    lotFieldsLoading = true;
    try {
      const result = await fetchCityLotFields(c.citySlug);
      if (lotFieldsForSlug === c.citySlug) lotFields = result;
    } catch {
      if (lotFieldsForSlug === c.citySlug) lotFieldsError = true;
    } finally {
      if (lotFieldsForSlug === c.citySlug) lotFieldsLoading = false;
    }
  }

  // ── Cohérence E2E (WP3 LOT1) : snapshot BATCH, un seul fetch partagé par
  // TOUTES les villes (jamais un fetch par ville — mode batch-pg, pas live).
  // Chargé une fois au montage ; la ville active est dérivée du même snapshot.
  let consistencyResponse: ConsistencyResponse | null = null;
  let consistencyLoading = false;
  let consistencyError = false;
  let consistencyRequested = false;

  async function loadConsistency(): Promise<void> {
    if (consistencyRequested) return;
    consistencyRequested = true;
    consistencyLoading = true;
    try {
      consistencyResponse = await fetchSourceConsistency();
    } catch {
      consistencyError = true;
    } finally {
      consistencyLoading = false;
    }
  }

  onMount(() => {
    void loadConsistency();
  });

  $: cityConsistency = getCityConsistency(city.citySlug, consistencyResponse);
  $: consistencyReliablePct = formatReliablePct(cityConsistency.edges.signalZone);
  $: consistencyFreshnessText = formatConsistencyFreshness(cityConsistency);

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
          ? `${city.signals.count} ${city.signals.count !== 1 ? "signaux" : "signal"} · ${city.signals.withCitation} avec citation vérifiable` +
            ((city.signals.priority ?? 0) > 0
              ? ` · ${city.signals.priority} prioritaire${city.signals.priority !== 1 ? "s" : ""} (zonage · 4+ · précoce)`
              : "")
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

  // Lignes « champs lot » (états async distincts, honnêtes). Les 4 taux
  // viennent de l'API (mesure live sur `qc-lots-<slug>`, % honnêtes 1..99
  // quand partiels, méthode d'échantillonnage DÉCLARÉE).
  $: lotFieldsResolved =
    lotFields !== null && lotFields.available && lotFields.fields !== undefined;
  $: lotFieldRows =
    lotFieldsResolved && lotFields?.fields
      ? [
          { key: "superficie", label: "Superficie", rate: lotFields.fields.superficie },
          { key: "adresse", label: "Adresse", rate: lotFields.fields.adresse },
          { key: "code-postal", label: "Code postal", rate: lotFields.fields.codePostal },
          { key: "normes", label: "Normes lot", rate: lotFields.fields.normes },
        ]
      : null;
  $: lotFieldsNote =
    lotFieldsResolved && lotFields ? lotFieldsMethodNote(lotFields) : null;
  $: lotFieldsPendingText = lotFieldsLoading
    ? "vérification en cours…"
    : lotFieldsError || (lotFields !== null && !lotFields.available)
      ? "donnée indisponible pour l'instant"
      : "vérification en cours…";

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
        {#if focusScope && isFocusCity(city, focusScope)}
          <!-- La ville porte ≥ 1 signal prioritaire z∩m∩p (cohorte « 33 »). -->
          <Badge tone="info" class="text-xs">Signaux précoces</Badge>
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
      {#if row.key === "lots"}
        <!-- Champs lot enrichis : détail LAZY (live) sous la ligne cadastre.
             4 taux honnêtes mesurés sur les lots servis par geo — s'AJOUTE aux
             couches existantes, ne remplace rien. -->
        <li class="px-4 py-2.5" data-testid="scorecard-lot-fields">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-semibold text-slate-700">
              Champs lot (superficie · adresse · code postal · normes)
            </p>
            {#if lotFieldsNote}
              <span class="shrink-0 text-xs text-slate-400">{lotFieldsNote}</span>
            {/if}
          </div>
          {#if !city.l5Lots.served}
            <p class="mt-1 text-xs text-slate-400">aucune donnée</p>
          {:else if lotFieldRows}
            <ul class="mt-1.5 space-y-1.5">
              {#each lotFieldRows as field (field.key)}
                <li
                  class="flex items-center justify-between gap-3"
                  data-testid={`lot-field-${field.key}`}
                >
                  <p class="min-w-0 pl-3 text-xs text-slate-600">{field.label}</p>
                  <div class="flex shrink-0 items-center gap-2">
                    <span class="text-xs tabular-nums text-slate-500">
                      {lotFieldEvidence(field.rate)}
                    </span>
                    <Badge tone={STATE_BADGE_TONE[field.rate.state]} class="text-xs">
                      {STATE_LABEL[field.rate.state]}
                    </Badge>
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-1 text-xs text-slate-400">{lotFieldsPendingText}</p>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>

  <!-- Cohérence E2E (WP3 LOT1) — SOUS la couverture, 2e badge SÉPARÉ (jamais
       un remplacement de « Couverture »). PV↔signal (E0) + signal↔zone (E1)
       uniquement à ce lot ; zone↔grille/zone↔lot viendront ensuite. -->
  <div
    class="border-t border-slate-200 px-4 py-3"
    data-testid="scorecard-consistency"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs font-semibold text-slate-700">Cohérence E2E</p>
      <Badge
        tone={consistencyLoading ? "neutral" : CONSISTENCY_STATE_BADGE_TONE[cityConsistency.state]}
        class="text-xs"
        data-testid="consistency-state-badge"
      >
        {consistencyLoading ? "—" : CONSISTENCY_STATE_LABEL[cityConsistency.state]}
      </Badge>
    </div>
    {#if consistencyLoading}
      <p class="mt-1.5 text-xs text-slate-400">vérification en cours…</p>
    {:else if consistencyError}
      <p class="mt-1.5 text-xs text-slate-400">donnée indisponible pour l'instant</p>
    {:else}
      <ul class="mt-1.5 space-y-1" data-testid="scorecard-consistency-edges">
        <li class="text-xs text-slate-600" data-testid="consistency-pv-signal">
          PV → signaux&nbsp;:
          <span class="tabular-nums">{formatEdgeCount(cityConsistency.edges.pvSignal)}</span>
        </li>
        <li class="text-xs text-slate-600" data-testid="consistency-signal-zone">
          signaux → zones&nbsp;:
          <span class="tabular-nums">{formatEdgeCount(cityConsistency.edges.signalZone)}</span>
          {#if consistencyReliablePct}
            <span class="text-slate-400">(dont fiables {consistencyReliablePct})</span>
          {/if}
        </li>
        {#if cityConsistency.blockers.length > 0}
          <li class="text-xs text-amber-700" data-testid="consistency-blocker">
            {cityConsistency.blockers.join(" · ")}
          </li>
        {/if}
      </ul>
      <p class="mt-1.5 text-xs text-slate-400" data-testid="consistency-freshness">
        {consistencyFreshnessText}
      </p>
    {/if}
  </div>

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
