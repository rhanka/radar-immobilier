<script lang="ts">
  /**
   * LotFichePanel — Fiche lot complète — CS-L2 (S-2), enrichie parité CS-L6.
   *
   * Affiche, au clic sur un lot dans la vue Évaluation, TOUTES les données
   * publiques que les propriétés du lot portent :
   * - Cadastre : noLot, adresse civique (quand la source l'expose — donnée
   *   publique du rôle, identifie la propriété, jamais une personne),
   *   superficie, façade (mesurée par la source, sinon ESTIMÉE depuis la
   *   géométrie — cf. estimatedFacadeM, méthode documentée).
   * - Zonage & critères : zone (code + type + usages + lien grille PDF via le
   *   join zone↔lot), périmètre TOD Oui/Non, multifamilial 4+ Oui/Non.
   * - Rôle d'évaluation (champs publics) : usage/catégorie, valeurs, nb
   *   logements/étages, année de construction.
   * - Score de potentiel (0–10) + lien Google Maps.
   *
   * ## Anti-PII strict (Loi 25)
   * Aucun nom de propriétaire ni donnée personnelle. L'adresse civique du LOT
   * est une donnée publique du rôle d'évaluation (elle identifie la propriété).
   *
   * ## Dégradé honnête
   * Chaque champ absent affiche « — » (copy neutre) ou omet sa rangée —
   * on n'affiche que ce que la source expose réellement, sans invention.
   *
   * ## Mobile
   * Sur < 768 px le panneau est affiché via Drawer DS. La version DS courante
   * expose seulement les côtés gauche/droite; le bottom sheet reste dépendant
   * d'une vague DS ultérieure. Sur desktop (md+), Card DS.
   */
  import { X, MapPin, Star, Info, ExternalLink, MessageSquare } from "@lucide/svelte";
  import { Badge, Card, Drawer } from "@sentropic/design-system-svelte";
  import type { LotFeature } from "$lib/maps/lots-client.js";
  import {
    centroid,
    estimatedFacadeM,
    formatArea,
    formatYesNo,
    googleMapsUrl,
    googleStreetViewUrl,
    reglementProvenance,
    scoreTone,
    scoreLabel,
    usageDominantDisplay,
  } from "$lib/components/maps/lot-fiche-utils.js";
  import {
    activeMarketMark,
    activePipelineMark,
    createProspectMark,
    createProspectNote,
    fetchProspectLotState,
    prospectStatusLabel,
    type ProspectMark,
    type ProspectNote,
    type ProspectMode,
    type PipelineStatus,
  } from "$lib/prospect/prospect-marks-client.js";
  import {
    assignmentStateLabel,
    auditCodeLabel,
    geometryProvenanceLabel,
    proofStatusLabel,
    publicAuditUrl,
    readinessLabel,
    AUDIT_NOT_COVERED_LABEL,
    AUDIT_NOT_COVERED_HINT,
  } from "$lib/maps/geo-provenance.js";

  // ── Props ────────────────────────────────────────────────────────────────────

  /** Le lot sélectionné (null = panneau fermé). */
  export let lot: LotFeature | null = null;

  /** Nom de la ville (pour l'affichage et le lien Maps). */
  export let cityName: string = "";

  /** Callback de fermeture. */
  export let onClose: () => void = () => {};

  /**
   * Autorise l'AFFICHAGE+ÉDITION du marquage d'équipe (donnée CLIENT, CS-L3).
   * Fail-closed (défaut `false`) : tant qu'aucun rôle de session OIDC n'est câblé
   * côté UI, ce drapeau EST le contrôle de rôle. La donnée publique (cadastre,
   * score, zonage) reste affichée quoi qu'il arrive.
   */
  export let allowMarquage: boolean = false;

  /** Mode d'origine des marquages posés depuis ce panneau (réel vs simulation). */
  export let mode: ProspectMode = "real";

  // ── Dérivés réactifs ─────────────────────────────────────────────────────────

  $: noLot = lot?.properties.noLot ?? "";
  $: lotVersionId = lot?.properties.lotVersionId ?? null;
  $: potentialScore = lot?.properties.potentialScore;
  $: superficieM2 = lot?.properties.superficieM2;
  $: valuation = lot?.properties.valuation;
  $: zone = lot?.properties.zone;
  $: zoneCode = lot?.properties.zoneCode ?? zone?.code;
  $: grillePdfUrl = lot?.properties.grillePdfUrl ?? zone?.grillePdfUrl;
  // Provenance du règlement en vigueur qui porte la norme de la zone jointe :
  // « Règl. {numero} ({millesime}) » + lien source, ou « Règlement non
  // renseigné » quand geo ne sert pas de numéro (jamais deviné).
  $: reglement = reglementProvenance(zone);
  // Usage dominant servi par geo (`qc-zonage-<slug>`) — « résidentiel
  // (nomenclature de zone) » ; null (aucune ligne) quand geo ne le sert pas.
  $: usageDominant = usageDominantDisplay(zone);
  $: lotCentroid = lot ? centroid(lot) : null;
  // Adresse civique du lot (donnée publique du rôle — jamais un propriétaire).
  $: adresse = lot?.properties.adresse ?? null;
  // Façade : mesurée par la source quand exposée, sinon estimée depuis la
  // géométrie (petit côté du rectangle englobant orienté minimal).
  $: facadeMesuree = lot?.properties.facadeM ?? null;
  $: facadeEstimee = lot && facadeMesuree === null ? estimatedFacadeM(lot) : null;
  $: profondeurM = lot?.properties.profondeurM ?? null;
  // Critères ciblage (booléens quand la source les expose, sinon undefined).
  $: todFlag = lot?.properties.tod;
  $: quatrePlusFlag = lot?.properties.multifamilial4plus;
  $: hasCriteres = todFlag !== undefined || quatrePlusFlag !== undefined;
  // Description verbatim de la zone (ex. « Min 16 log · 6 étages · Mixte »).
  $: zoneDescription = lot?.properties.zoneDescription ?? null;
  // Normes de zonage verbatim (grille) quand la source les expose.
  $: normes = lot?.properties.normes ?? null;
  $: normesRows = (normes
    ? ([
        ["Hauteur", normes.hauteur],
        ["Étages", normes.etages],
        ["Marge avant", normes.margeAvant],
        ["Marge arrière", normes.margeArriere],
        ["Marge latérale", normes.margeLaterale],
        ["Densité", normes.densite],
      ] as Array<[string, string | null | undefined]>)
    : []
  ).filter((row): row is [string, string] => row[1] != null);
  $: proof = lot?.properties.proof;
  $: provenance = lot?.properties.immo_zone_lot_provenance;
  $: assignment = provenance?.lot_assignment_evidence;
  $: geometryProvenance = provenance?.zone_geometry_provenance;
  $: readiness = provenance?.acquisition_v2_readiness;
  $: geometrySourceUrl = publicAuditUrl(geometryProvenance?.public_source?.url);
  $: proofGeometrySourceUrl = publicAuditUrl(proof?.geometry_source?.url);
  // Libellé de source honnête selon le mode.
  $: sourceLabel = mode === "simulation"
    ? "Rôle d'évaluation 2022 · zonage municipal"
    : "Cadastre allégé MRNF";
  let prospectLoading = false;
  let prospectError: string | null = null;
  let prospectMarks: ProspectMark[] = [];
  let prospectNotes: ProspectNote[] = [];
  let prospectRequestKey = "";

  $: citySlug = lot?.properties.citySlug ?? "";
  $: mapsUrl = lotCentroid
    ? googleMapsUrl(lotCentroid.lat, lotCentroid.lon)
    : null;
  $: streetViewUrl = lotCentroid
    ? googleStreetViewUrl(lotCentroid.lat, lotCentroid.lon)
    : null;
  $: drawerOpen = lot !== null;
  $: pipelineMark = activePipelineMark(prospectMarks);
  $: marketMark = activeMarketMark(prospectMarks);
  $: latestNotes = [...prospectNotes]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 3);

  $: {
    const key = noLot && citySlug ? `${citySlug}::${noLot}` : "";
    if (key && key !== prospectRequestKey) {
      prospectRequestKey = key;
      void loadProspectState(noLot, citySlug);
    } else if (!key && prospectRequestKey) {
      prospectRequestKey = "";
      prospectMarks = [];
      prospectNotes = [];
      prospectError = null;
      prospectLoading = false;
    }
  }

  // formatArea / formatYesNo : partagés via lot-fiche-utils (carte lot Signaux).
  function formatMoney(value: number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatMeters(value: number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    return `${value.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} m`;
  }

  async function loadProspectState(noLotValue: string, citySlugValue: string): Promise<void> {
    prospectLoading = true;
    prospectError = null;
    try {
      const state = await fetchProspectLotState(noLotValue, citySlugValue);
      if (prospectRequestKey !== `${citySlugValue}::${noLotValue}`) return;
      prospectMarks = state.marks;
      prospectNotes = state.notes;
    } catch (e) {
      if (prospectRequestKey !== `${citySlugValue}::${noLotValue}`) return;
      prospectMarks = [];
      prospectNotes = [];
      prospectError = e instanceof Error ? e.message : "Marquage indisponible";
    } finally {
      if (prospectRequestKey === `${citySlugValue}::${noLotValue}`) {
        prospectLoading = false;
      }
    }
  }

  // ── Écriture marquage (append-only, gatée allowMarquage) ────────────────────
  let prospectSaving = false;
  let noteDraft = "";

  const PIPELINE_ACTIONS: Array<{ statut: PipelineStatus; label: string }> = [
    { statut: "favori", label: "Favori" },
    { statut: "sollicite", label: "Sollicité" },
    { statut: "lettre_envoyee", label: "Lettre envoyée" },
    { statut: "ecarte", label: "Écarté" },
  ];

  async function setPipeline(statut: PipelineStatus): Promise<void> {
    if (!allowMarquage || !lotVersionId || !noLot || !citySlug || prospectSaving) return;
    prospectSaving = true;
    prospectError = null;
    try {
      await createProspectMark({ lotVersionId, noLot, citySlug, dimension: "pipeline", statut, mode });
      await loadProspectState(noLot, citySlug);
    } catch (e) {
      prospectError = e instanceof Error ? e.message : "Marquage échoué";
    } finally {
      prospectSaving = false;
    }
  }

  async function toggleEnVente(): Promise<void> {
    if (!allowMarquage || !lotVersionId || !noLot || !citySlug || prospectSaving) return;
    prospectSaving = true;
    prospectError = null;
    try {
      await createProspectMark({ lotVersionId, noLot, citySlug, dimension: "marche", statut: "en_vente", mode });
      await loadProspectState(noLot, citySlug);
    } catch (e) {
      prospectError = e instanceof Error ? e.message : "Marquage échoué";
    } finally {
      prospectSaving = false;
    }
  }

  async function submitNote(): Promise<void> {
    const body = noteDraft.trim();
    if (!allowMarquage || !body || !noLot || !citySlug || prospectSaving) return;
    prospectSaving = true;
    prospectError = null;
    try {
      await createProspectNote({ noLot, citySlug, body, mode, ...(lotVersionId ? { lotVersionId } : {}) });
      noteDraft = "";
      await loadProspectState(noLot, citySlug);
    } catch (e) {
      prospectError = e instanceof Error ? e.message : "Note échouée";
    } finally {
      prospectSaving = false;
    }
  }
</script>

{#if lot}
  <!--
    Mobile (<768px) : Drawer DS.
    Desktop (md+) : Card DS — panneau inline dans le flux.
  -->

  <!-- Mobile : Drawer DS (masqué sur desktop via wrapper md:hidden) -->
  <div class="md:hidden">
    <Drawer
      open={drawerOpen}
      title="Fiche lot {noLot}"
      description="{sourceLabel} · Anti-PII Loi 25"
      side="right"
      closeLabel="Fermer la fiche lot"
      onclose={onClose}
      data-testid="lot-fiche-panel-mobile"
    >
      {#snippet children()}
        <div class="space-y-4" data-testid="lot-fiche-panel-mobile-body">
          <!-- N° lot + adresse -->
          <p class="text-xs text-slate-500">
            N° lot : <span class="font-mono font-semibold text-slate-900" data-testid="fiche-nolot-mobile">{noLot}</span>
            {#if adresse}
              <span class="block text-slate-700" data-testid="fiche-adresse-mobile">{adresse}</span>
            {/if}
          </p>

          <!-- Score -->
          {#if potentialScore !== undefined}
            <div class="flex items-center gap-2" data-testid="fiche-score-mobile">
              <span class="text-2xl font-bold text-slate-900">
                {potentialScore}<span class="text-sm font-normal text-slate-400">/10</span>
              </span>
              <Badge tone={scoreTone(potentialScore)}>{scoreLabel(potentialScore)}</Badge>
            </div>
          {/if}

          <!-- Lien Maps -->
          {#if mapsUrl}
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 hover:border-teal-300 hover:bg-teal-50"
              data-testid="fiche-maps-link-mobile"
              aria-label="Ouvrir le lot {noLot} dans Google Maps (nouvelle fenêtre)"
            >
              <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Voir dans Google Maps
            </a>
          {/if}

          <!-- Note anti-PII -->
          <p class="text-xs text-slate-300 border-t border-slate-100 pt-3">
            Anti-PII (Loi 25) : aucun nom de propriétaire ni donnée personnelle n'est affichée.
          </p>
        </div>
      {/snippet}
    </Drawer>
  </div>

  <!-- Desktop : Card DS (md+) -->
  <Card class="hidden md:block overflow-hidden" data-testid="lot-fiche-panel">
    <div role="region" aria-label="Fiche du lot {noLot}">
    <!-- ── En-tête ─────────────────────────────────────────────────────────── -->
    <div
      class="
        sticky top-0 z-10
        flex items-center justify-between gap-3
        border-b border-teal-100 bg-teal-50 px-4 py-3
      "
    >
      <div class="flex items-center gap-2 min-w-0">
        <MapPin class="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-xs text-teal-600 font-medium uppercase tracking-wide">Fiche lot</p>
          <p class="font-mono text-base font-bold text-teal-900 truncate" data-testid="fiche-nolot">
            {noLot}
          </p>
          {#if adresse}
            <p class="text-xs text-teal-700 truncate" data-testid="fiche-adresse-header">{adresse}</p>
          {/if}
        </div>
      </div>
      <button
        type="button"
        class="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-teal-100 hover:text-teal-700 shrink-0"
        on:click={onClose}
        aria-label="Fermer la fiche lot"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>

    <!-- ── Corps ──────────────────────────────────────────────────────────── -->
    <div class="p-4 space-y-4">

      <!-- Section Cadastre ────────────────────────────────────────────────── -->
      <section aria-labelledby="section-cadastre">
        <h3
          id="section-cadastre"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"
        >
          Cadastre
        </h3>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-slate-500">N° lot</dt>
          <dd class="font-mono font-medium text-slate-900" data-testid="fiche-nolot-dd">
            {noLot}
          </dd>
          {#if adresse}
            <dt class="text-slate-500">Adresse</dt>
            <dd class="text-slate-700" data-testid="fiche-adresse">{adresse}</dd>
          {/if}
          {#if lot?.properties.citySlug}
            <dt class="text-slate-500">Ville</dt>
            <dd class="text-slate-700">{cityName || lot.properties.citySlug}</dd>
          {/if}
          <dt class="text-slate-500">Superficie</dt>
          <dd class:text-slate-700={superficieM2 !== undefined && superficieM2 !== null} class:text-slate-400={superficieM2 === undefined || superficieM2 === null} class="text-xs">
            {formatArea(superficieM2)}
          </dd>
          <dt class="text-slate-500">{facadeMesuree !== null ? "Façade" : "Façade estimée"}</dt>
          <dd class="text-xs text-slate-700" data-testid="fiche-facade">
            {facadeMesuree !== null ? formatMeters(facadeMesuree) : formatMeters(facadeEstimee)}
          </dd>
          {#if profondeurM !== null}
            <dt class="text-slate-500">Profondeur</dt>
            <dd class="text-xs text-slate-700" data-testid="fiche-profondeur">{formatMeters(profondeurM)}</dd>
          {/if}
          <dt class="text-slate-500">Source</dt>
          <dd class="text-slate-700">{sourceLabel}</dd>
        </dl>
        {#if facadeMesuree === null && facadeEstimee !== null}
          <p class="mt-1 text-xs text-slate-400" data-testid="fiche-facade-methode">
            Façade estimée depuis la géométrie du lot (petit côté du rectangle englobant orienté).
          </p>
        {/if}
      </section>

      <!-- Section Score de potentiel ──────────────────────────────────────── -->
      <section aria-labelledby="section-score">
        <h3
          id="section-score"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"
        >
          <Star class="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
          Score de potentiel
        </h3>

        {#if potentialScore !== undefined}
          <div class="flex items-center gap-3" data-testid="fiche-score">
            <span class="text-2xl font-bold text-slate-900">
              {potentialScore}<span class="text-sm font-normal text-slate-400">/10</span>
            </span>
            <Badge tone={scoreTone(potentialScore)}>
              {scoreLabel(potentialScore)}
            </Badge>
          </div>
          <p class="mt-1.5 text-xs text-slate-400">
            Échelle 0–10 · distinct du score T2 (0-5) et du score legacy (0-100).
            Basé sur la densité de zone, le type, la présence en périmètre TOD.
          </p>
        {:else}
          <div
            class="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="fiche-score-na"
          >
            <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
            <p>Score non disponible pour ce lot.</p>
          </div>
        {/if}
      </section>

      <!-- Section Critères ciblage (TOD, multifamilial 4+) ─────────────────── -->
      {#if hasCriteres}
        <section aria-labelledby="section-criteres">
          <h3
            id="section-criteres"
            class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Critères ciblage
          </h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm" data-testid="fiche-criteres">
            <dt class="text-slate-500">Périmètre TOD</dt>
            <dd data-testid="fiche-tod">
              <Badge tone={todFlag ? "info" : "neutral"} class="text-xs">{formatYesNo(todFlag)}</Badge>
            </dd>
            <dt class="text-slate-500">Multifamilial 4+</dt>
            <dd data-testid="fiche-4plus">
              <Badge tone={quatrePlusFlag ? "success" : "neutral"} class="text-xs">{formatYesNo(quatrePlusFlag)}</Badge>
            </dd>
          </dl>
        </section>
      {/if}

      <!-- Section Rôle MAMH (champs publics) ──────────────────────────────── -->
      <section aria-labelledby="section-role">
        <h3
          id="section-role"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Rôle MAMH (évaluation foncière)
        </h3>
        {#if valuation}
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm" data-testid="fiche-role">
            <dt class="text-slate-500">Usage</dt>
            <dd class="text-slate-700">{valuation.usageCode ?? lot.properties.usageCode ?? "—"}</dd>
            <dt class="text-slate-500">Catégorie</dt>
            <dd class="text-slate-700" data-testid="fiche-categorie">{valuation.categorie ?? "—"}</dd>
            <dt class="text-slate-500">Valeur totale</dt>
            <dd class="text-slate-700">{formatMoney(valuation.valeurTotale)}</dd>
            <dt class="text-slate-500">Terrain</dt>
            <dd class="text-slate-700">{formatMoney(valuation.valeurTerrain)}</dd>
            <dt class="text-slate-500">Bâtiment</dt>
            <dd class="text-slate-700">{formatMoney(valuation.valeurBatiment)}</dd>
            <dt class="text-slate-500">Logements / étages</dt>
            <dd class="text-slate-700">{valuation.nbLogements ?? "—"} / {valuation.nbEtages ?? "—"}</dd>
            <dt class="text-slate-500">Année de construction</dt>
            <dd class="text-slate-700" data-testid="fiche-annee">{valuation.anneeConstruction ?? "—"}</dd>
          </dl>
          <p class="mt-1.5 text-xs text-slate-400">Champs publics seulement; aucun nom de propriétaire.</p>
        {:else}
          <div
            class="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            data-testid="fiche-role-na"
          >
            <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
            <p>Données du rôle d'évaluation non disponibles pour ce lot.</p>
          </div>
        {/if}
      </section>

      <!-- Section Zone ────────────────────────────────────────────────────── -->
      <section aria-labelledby="section-zone">
        <h3
          id="section-zone"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Zone (règlement de zonage)
        </h3>
        {#if zone || zoneCode || grillePdfUrl || zoneDescription || normesRows.length > 0}
          <div class="space-y-2 rounded-lg border border-slate-100 bg-white px-3 py-2" data-testid="fiche-zone">
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt class="text-slate-500">Code zone</dt>
              <dd class="font-mono text-slate-700" data-testid="fiche-zone-code">{zoneCode ?? "—"}</dd>
              <dt class="text-slate-500">Type</dt>
              <dd class="text-slate-700">{zone?.kind && zone.kind !== "non précisé" ? zone.kind : "—"}</dd>
              <dt class="text-slate-500">Densité</dt>
              <dd class="text-slate-700">{zone?.densiteLogHa ?? "—"}{zone?.densiteLogHa !== null && zone?.densiteLogHa !== undefined ? " log/ha" : ""}</dd>
              <dt class="text-slate-500">Usages</dt>
              <dd class="text-slate-700">{zone?.usages?.length ? zone.usages.join(", ") : "—"}</dd>
              {#if usageDominant}
                <dt class="text-slate-500">Usage dominant</dt>
                <dd class="text-slate-700" data-testid="fiche-usage-dominant">{usageDominant}</dd>
              {/if}
              {#if zoneDescription}
                <dt class="text-slate-500">Description</dt>
                <dd class="text-slate-700" data-testid="fiche-zone-desc">{zoneDescription}</dd>
              {/if}
            </dl>
            {#if normesRows.length > 0}
              <div class="border-t border-slate-100 pt-2" data-testid="fiche-normes">
                <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Normes de la grille
                </p>
                <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {#each normesRows as [label, value] (label)}
                    <dt class="text-slate-500">{label}</dt>
                    <dd class="text-slate-700">{value}</dd>
                  {/each}
                </dl>
              </div>
            {/if}
            {#if reglement}
              <div class="border-t border-slate-100 pt-2" data-testid="fiche-reglement">
                <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Provenance du règlement
                </p>
                {#if reglement.url}
                  <a
                    href={reglement.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:underline"
                    data-testid="fiche-reglement-link"
                  >
                    <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {reglement.text}
                  </a>
                {:else}
                  <p class="text-sm text-slate-700" data-testid="fiche-reglement-text">
                    {reglement.text}
                  </p>
                {/if}
              </div>
            {/if}
            {#if grillePdfUrl}
              <a
                href={grillePdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
                data-testid="fiche-grille-pdf-link"
              >
                <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Ouvrir la grille de zonage PDF
              </a>
            {/if}
          </div>
        {:else}
          <div
            class="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            data-testid="fiche-zone-na"
          >
            <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
            <p>Informations de zonage non disponibles pour ce lot.</p>
          </div>
        {/if}
      </section>

      <section aria-labelledby="section-audit" data-testid="fiche-audit">
        <h3
          id="section-audit"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Audit des sources
        </h3>
        {#if proof || provenance}
          <div class="space-y-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">
            {#if proof}
              <div data-testid="fiche-proof">
                <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
                  <dt class="text-slate-500">État de la preuve</dt>
                  <dd class="text-slate-700">{proofStatusLabel(proof.status)}</dd>
                  <dt class="text-slate-500">Source géométrique</dt>
                  <dd class="text-slate-700">{proof.sources?.geometry?.status === "available" ? "Disponible" : proof.sources?.geometry?.status === "unavailable" ? "Indisponible" : "Non indiquée"}</dd>
                  <dt class="text-slate-500">Source réglementaire</dt>
                  <dd class="text-slate-700">{proof.sources?.regulation?.status === "available" ? "Disponible" : proof.sources?.regulation?.status === "unavailable" ? "Indisponible" : "Non indiquée"}</dd>
                  {#if proofGeometrySourceUrl}
                    <dt class="text-slate-500">Source géométrique publiée</dt>
                    <dd><a href={proofGeometrySourceUrl} target="_blank" rel="noopener noreferrer" class="text-teal-700 hover:underline" data-testid="fiche-proof-geometry-source-link">Consulter la source</a></dd>
                  {/if}
                </dl>
                {#if proof.gaps?.length}
                  <ul class="mt-2 space-y-1 text-xs text-slate-600" data-testid="fiche-proof-gaps">
                    {#each proof.gaps as gap (gap)}
                      <li>{auditCodeLabel(gap)}</li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}

            {#if provenance}
              <div class="border-t border-slate-100 pt-2" data-testid="fiche-zone-lot-provenance">
                <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
                  <dt class="text-slate-500">Origine de la géométrie</dt>
                  <dd class="text-slate-700">{geometryProvenanceLabel(geometryProvenance?.status)}</dd>
                  {#if geometrySourceUrl}
                    <dt class="text-slate-500">Source publique</dt>
                    <dd><a href={geometrySourceUrl} target="_blank" rel="noopener noreferrer" class="text-teal-700 hover:underline" data-testid="fiche-geometry-source-link">Consulter la source</a></dd>
                  {/if}
                  <dt class="text-slate-500">Rattachement du lot</dt>
                  <dd class="text-slate-700">{assignmentStateLabel(assignment?.state)}</dd>
                  <dt class="text-slate-500">Zone sélectionnée</dt>
                  <dd class="font-mono text-slate-700">{assignment?.selected_zone ? `${assignment.selected_zone.collection ?? "—"} · ${assignment.selected_zone.code ?? "—"}` : "—"}</dd>
                  <dt class="text-slate-500">Méthode</dt>
                  <dd class="text-slate-700">{assignment?.assignment_method ?? "Non indiquée"}</dd>
                  <dt class="text-slate-500">Part dominante</dt>
                  <dd class="text-slate-700">{assignment?.dominant_fraction == null ? "—" : `${(assignment.dominant_fraction * 100).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} %`}</dd>
                  <dt class="text-slate-500">Plusieurs zones</dt>
                  <dd class="text-slate-700">{assignment?.multi_zone == null ? "Non indiqué" : assignment.multi_zone ? "Oui" : "Non"}</dd>
                  <dt class="text-slate-500">État du dossier</dt>
                  <dd class="text-slate-700">{readinessLabel(readiness?.state)}</dd>
                </dl>
                {#if geometryProvenance?.reason_codes?.length || readiness?.unmet_requirement_codes?.length}
                  <ul class="mt-2 space-y-1 text-xs text-slate-600" data-testid="fiche-provenance-gaps">
                    {#each geometryProvenance?.reason_codes ?? [] as code (code)}<li>{auditCodeLabel(code)}</li>{/each}
                    {#each readiness?.unmet_requirement_codes ?? [] as code (code)}<li>{auditCodeLabel(code)}</li>{/each}
                  </ul>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div
            class="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            data-testid="fiche-audit-empty"
          >
            <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
            <p><span class="font-semibold text-slate-600">{AUDIT_NOT_COVERED_LABEL}</span> — {AUDIT_NOT_COVERED_HINT}</p>
          </div>
        {/if}
      </section>

      <!-- Section Marquage équipe + notes (CS-L3) ─────────────────────────── -->
      <section aria-labelledby="section-notes">
        <h3
          id="section-notes"
          class="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          <MessageSquare class="h-3.5 w-3.5 text-teal-600 shrink-0" aria-hidden="true" />
          Marquage équipe & notes
        </h3>

        {#if !citySlug}
          <div
            class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            data-testid="fiche-prospect-city-missing"
          >
            Marquage indisponible : citySlug absent du lot GeoJSON.
          </div>
        {:else if prospectLoading}
          <div
            class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-400"
            data-testid="fiche-prospect-loading"
          >
            Chargement des marques et notes…
          </div>
        {:else if prospectError}
          <div
            class="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="fiche-prospect-error"
          >
            Marquage/notes indisponibles — {prospectError}.
          </div>
        {:else}
          <div class="space-y-3" data-testid="fiche-prospect-state">
            <div class="flex flex-wrap gap-1.5">
              {#if pipelineMark}
                <Badge tone={pipelineMark.statut === "ecarte" ? "neutral" : "success"} class="text-xs">
                  Pipeline : {prospectStatusLabel(pipelineMark.statut)}
                </Badge>
              {:else}
                <Badge tone="neutral" class="text-xs">Pipeline : non marqué</Badge>
              {/if}
              {#if marketMark}
                <Badge tone="warning" class="text-xs">Marché : {prospectStatusLabel(marketMark.statut)}</Badge>
              {/if}
              <Badge tone="neutral" class="text-xs">{prospectNotes.length} note{prospectNotes.length !== 1 ? "s" : ""}</Badge>
            </div>

            {#if latestNotes.length > 0}
              <ul class="space-y-1.5" aria-label="Dernières notes équipe">
                {#each latestNotes as note (note.id)}
                  <li class="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
                    <p class="whitespace-pre-wrap leading-snug">{note.body}</p>
                    <p class="mt-1 text-[11px] text-slate-400">
                      {new Date(note.createdAt).toLocaleString("fr-CA")} · {note.mode === "simulation" ? "simulation" : "réel"}
                    </p>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 italic">
                Aucune note pour ce lot.
              </p>
            {/if}

            {#if allowMarquage}
              <div class="space-y-2 border-t border-slate-100 pt-2" data-testid="fiche-prospect-edit">
                <div class="flex flex-wrap gap-1.5">
                  {#each PIPELINE_ACTIONS as action (action.statut)}
                    <button
                      type="button"
                      class="rounded-md border px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 {pipelineMark?.statut === action.statut ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
                      disabled={!lotVersionId || prospectSaving}
                      on:click={() => setPipeline(action.statut)}
                    >
                      {action.label}
                    </button>
                  {/each}
                  <button
                    type="button"
                    class="rounded-md border px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 {marketMark ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
                    disabled={!lotVersionId || prospectSaving}
                    on:click={toggleEnVente}
                  >
                    En vente
                  </button>
                </div>
                {#if !lotVersionId}
                  <p class="text-[11px] text-slate-400 italic" data-testid="fiche-prospect-no-version">
                    Statuts désactivés : ce lot n'expose pas encore son identifiant de version (lotVersionId) côté collection geo. Les notes restent possibles.
                  </p>
                {/if}
                <div class="space-y-1">
                  <textarea
                    class="w-full resize-none rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-teal-400 focus:outline-none"
                    rows="2"
                    placeholder="Ajouter une note d'équipe…"
                    bind:value={noteDraft}
                    disabled={prospectSaving}
                    aria-label="Note d'équipe"
                  ></textarea>
                  <div class="flex justify-end">
                    <button
                      type="button"
                      class="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!noteDraft.trim() || prospectSaving}
                      on:click={submitNote}
                    >
                      {prospectSaving ? "Enregistrement…" : "Ajouter la note"}
                    </button>
                  </div>
                </div>
              </div>
            {:else}
              <p class="text-xs text-slate-400" data-testid="fiche-prospect-readonly">
                Édition réservée au poste de prospection.
              </p>
            {/if}
          </div>
        {/if}
      </section>

      <!-- Section Lien Google Maps ─────────────────────────────────────────── -->
      {#if mapsUrl}
        <section aria-labelledby="section-maps">
          <h3
            id="section-maps"
            class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Géolocalisation
          </h3>
          <div class="flex flex-wrap gap-2">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
              data-testid="fiche-maps-link"
              aria-label="Ouvrir le lot {noLot} dans Google Maps (nouvelle fenêtre)"
            >
              <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Google Maps
            </a>
            {#if streetViewUrl}
              <a
                href={streetViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
                data-testid="fiche-streetview-link"
                aria-label="Ouvrir Street View près du lot {noLot} (nouvelle fenêtre)"
              >
                <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Street View
              </a>
            {/if}
          </div>
          {#if lotCentroid}
            <p class="mt-1 text-xs text-slate-400">
              Centroïde approché : {lotCentroid.lat.toFixed(5)}°N, {lotCentroid.lon.toFixed(5)}°E
            </p>
          {/if}
        </section>
      {/if}

      <!-- Note anti-PII ───────────────────────────────────────────────────── -->
      <p class="text-xs text-slate-300 border-t border-slate-100 pt-3">
        Anti-PII (Loi 25) : aucun nom de propriétaire ni donnée personnelle n'est affichée.
        Données publiques (cadastre et rôle d'évaluation).
      </p>
    </div>
    </div>
  </Card>
{/if}
