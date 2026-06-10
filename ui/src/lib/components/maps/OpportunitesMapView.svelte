<script lang="ts">
  /**
   * OpportunitesMapView — Vue Opportunités : classement par score.
   *
   * Affiche le classement des changements de zonage scorés de TOUTES les villes
   * (données réelles : GET /api/opportunites), triés par score décroissant.
   *
   * Chaque opportunité montre :
   *   - ville, règlements, zones
   *   - score 0-100 (barre visuelle)
   *   - décomposition des facteurs : proximité, type de zone, récence
   *
   * Anti-invention :
   *   - Seuls les DesignationEvent réels sont affichés.
   *   - Aucun score inventé : score = fonction transparente de données réelles.
   *   - État honnête (chargement / vide) avec explication.
   *   - Aucune PII.
   *
   * DS-lint : Badge + Alert de @sentropic/design-system-svelte uniquement.
   */
  import { onMount } from "svelte";
  import { TrendingUp, RefreshCw, Info } from "@lucide/svelte";
  import { Badge, Alert } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    fetchOpportunites,
    type OpportuniteItem,
  } from "$lib/opportunites/opportunites-client.js";
  import { QC_MUNICIPALITIES } from "@radar/sources/municipalities";

  // ── City name lookup ────────────────────────────────────────────────────────
  const CITY_NAMES: Map<string, string> = new Map(
    QC_MUNICIPALITIES.map((m) => [m.slug, m.name]),
  );

  function cityName(slug: string): string {
    return CITY_NAMES.get(slug) ?? slug;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let loading = true;
  let loadError: string | null = null;
  let items: OpportuniteItem[] = [];
  let scoreVersion = "v1";
  let selectedItem: OpportuniteItem | null = null;

  // ── Chargement API ─────────────────────────────────────────────────────────
  async function load(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const res = await fetchOpportunites();
      items = res.items;
      scoreVersion = res.scoreVersion;
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Erreur de chargement";
      items = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Score colour: ≥70 teal, ≥50 amber, <50 slate */
  function scoreTone(score: number): string {
    if (score >= 70) return "text-teal-700";
    if (score >= 50) return "text-amber-600";
    return "text-slate-500";
  }

  /** Progress bar colour for score */
  function scoreBarClass(score: number): string {
    if (score >= 70) return "bg-teal-500";
    if (score >= 50) return "bg-amber-400";
    return "bg-slate-300";
  }

  /** Format a factor 0–1 as a percentage label */
  function pct(v: number): string {
    return `${Math.round(v * 100)}%`;
  }

  /** Zone refs: residential/mixed → success badge, commercial → neutral */
  const RESIDENTIAL_RE = /^(H|RM|MXTV|R)-/i;

  function zoneTone(zone: string): "success" | "neutral" {
    return RESIDENTIAL_RE.test(zone) ? "success" : "neutral";
  }

  function toggleSelected(item: OpportuniteItem): void {
    selectedItem =
      selectedItem?.citySlug === item.citySlug &&
      selectedItem?.reglementNumbers.join() === item.reglementNumbers.join()
        ? null
        : item;
  }
</script>

<ViewLayout controlsWidth="w-80">
  <!-- ── Left sidebar: résumé + légende ───────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 class="flex items-center gap-2 text-sm font-bold text-slate-900">
        <TrendingUp class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Opportunités : classement
      </h1>
      <button
        type="button"
        aria-label="Actualiser"
        class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        on:click={load}
        disabled={loading}
      >
        <RefreshCw
          class={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
      </button>
    </div>

    <!-- Compteur global -->
    <div class="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
      {#if loading}
        <span class="text-slate-400">Chargement…</span>
      {:else if loadError}
        <span class="text-red-500">Erreur — données indisponibles</span>
      {:else}
        <span class="font-semibold text-slate-700">{items.length}</span>
        opportunité{items.length !== 1 ? "s" : ""} ·
        score <span class="font-mono text-xs">{scoreVersion}</span>
      {/if}
    </div>

    <!-- Légende score -->
    <div class="border-b border-slate-100 px-4 py-3">
      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Score 0–100
      </p>
      <ul class="space-y-1">
        {#each [
          { cls: "bg-teal-500", label: "≥ 70 — forte opportunité" },
          { cls: "bg-amber-400", label: "50–69 — modérée" },
          { cls: "bg-slate-300", label: "< 50 — signal faible" },
        ] as leg (leg.label)}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span class={`h-2.5 w-2.5 rounded-full ${leg.cls}`}></span>
            {leg.label}
          </li>
        {/each}
      </ul>
    </div>

    <!-- Formule -->
    <div class="px-4 py-3">
      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Formule v1
      </p>
      <ul class="space-y-0.5 text-xs text-slate-500">
        <li><span class="font-medium text-slate-700">Proximité MTL</span> × 40 %</li>
        <li><span class="font-medium text-slate-700">Type de zone</span> × 40 %</li>
        <li><span class="font-medium text-slate-700">Récence</span> × 20 %</li>
      </ul>
      <p class="mt-1.5 text-xs text-slate-400">
        Données réelles uniquement. Aucun prix fictif.
      </p>
    </div>
  </svelte:fragment>

  <!-- ── Main: classement des opportunités ─────────────────────────────────── -->
  <div class="flex h-full flex-col bg-slate-50 p-4 gap-4 overflow-y-auto">

    {#if loading}
      <div class="flex flex-1 items-center justify-center py-16 text-slate-400">
        <RefreshCw class="h-6 w-6 animate-spin mr-2" aria-hidden="true" />
        <span class="text-sm">Chargement des opportunités…</span>
      </div>

    {:else if loadError}
      <Alert
        tone="error"
        title="Erreur de chargement"
        message="{loadError} — Les données de changements de zonage sont indisponibles."
      />

    {:else if items.length === 0}
      <Alert
        tone="info"
        title="Aucune opportunité disponible."
        message="Les opportunités sont dérivées des DesignationEvent de l'état projet ontologie. Aucun état projet n'a encore été généré pour les villes du périmètre."
      />

    {:else}
      <!-- En-tête -->
      <div class="flex items-center gap-2 px-1">
        <TrendingUp class="h-4 w-4 text-teal-600" aria-hidden="true" />
        <h2 class="text-sm font-semibold text-slate-700">
          Top opportunités — {items.length} changement{items.length !== 1 ? "s" : ""} de zonage scorés
        </h2>
      </div>

      <!-- Liste classée par score décroissant -->
      <ul class="space-y-2" aria-label="Classement des opportunités par score">
        {#each items as item, rank (item.citySlug + "/" + item.reglementNumbers.join(","))}
          {@const isExpanded =
            selectedItem?.citySlug === item.citySlug &&
            selectedItem?.reglementNumbers.join() === item.reglementNumbers.join()}
          <li>
            <button
              type="button"
              class={`w-full rounded-xl border text-left transition-all ${
                isExpanded
                  ? "border-teal-300 bg-teal-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
              } px-4 py-3`}
              on:click={() => toggleSelected(item)}
            >
              <!-- Rang + ville + score -->
              <div class="flex items-center gap-3">
                <span class="shrink-0 w-5 text-center text-xs font-mono text-slate-400">
                  #{rank + 1}
                </span>

                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-900 truncate">
                    {cityName(item.citySlug)}
                  </p>
                  <div class="flex flex-wrap gap-1 mt-0.5">
                    {#each item.reglementNumbers as num (num)}
                      <Badge tone="neutral" class="text-xs font-mono">Règl. {num}</Badge>
                    {/each}
                    {#each item.zoneRefs as zone (zone)}
                      <Badge tone={zoneTone(zone)} class="text-xs font-mono">
                        Zone {zone}
                      </Badge>
                    {/each}
                  </div>
                </div>

                <!-- Score badge -->
                <div class="shrink-0 text-right">
                  <span class={`text-lg font-bold tabular-nums ${scoreTone(item.score)}`}>
                    {item.score}
                  </span>
                  <span class="text-xs text-slate-400">/100</span>
                </div>
              </div>

              <!-- Barre de score -->
              <div class="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                <div
                  class={`h-full rounded-full transition-all ${scoreBarClass(item.score)}`}
                  style="width: {item.score}%"
                ></div>
              </div>

              <!-- Détail déplié -->
              {#if isExpanded}
                <div class="mt-3 border-t border-teal-100 pt-3 space-y-3">
                  <!-- Label source (verbatim) -->
                  <p class="text-xs text-teal-800 leading-snug font-medium">
                    {item.label}
                  </p>

                  <!-- Décomposition facteurs -->
                  <div class="grid grid-cols-3 gap-2">
                    {#each [
                      { key: "proximite", label: "Proximité MTL", value: item.facteurs.proximite, weight: "40%" },
                      { key: "zoneType", label: "Type de zone", value: item.facteurs.zoneType, weight: "40%" },
                      { key: "recence", label: "Récence", value: item.facteurs.recence, weight: "20%" },
                    ] as facteur (facteur.key)}
                      <div class="rounded-lg border border-teal-100 bg-white px-2 py-2 text-center">
                        <p class="text-xs text-slate-400 leading-tight">{facteur.label}</p>
                        <p class="text-sm font-bold text-slate-800 tabular-nums">
                          {pct(facteur.value)}
                        </p>
                        <p class="text-xs text-slate-400">pond. {facteur.weight}</p>
                      </div>
                    {/each}
                  </div>

                  <!-- Date + source -->
                  <div class="flex flex-wrap gap-3 text-xs text-slate-400">
                    {#if item.dateObserved}
                      <span>
                        Observé :
                        <span class="font-medium text-slate-600">
                          {new Date(item.dateObserved).toLocaleDateString("fr-CA")}
                        </span>
                      </span>
                    {/if}
                    {#if item.sourceRef}
                      <span class="truncate max-w-xs" title={item.sourceRef}>
                        Source : <span class="font-mono text-teal-600">{item.sourceRef}</span>
                      </span>
                    {/if}
                  </div>

                  <!-- Note honnêteté -->
                  <div class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" aria-hidden="true" />
                    <p>
                      Score <strong>v1 simplifié</strong> : proximité + type de zone + récence.
                      Ne tient pas compte de la faisabilité terrain, contraintes ou marché
                      (données non encore disponibles). Indicatif uniquement.
                    </p>
                  </div>
                </div>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</ViewLayout>
