<script lang="ts">
  /**
   * WP6 — Vue Backlog (branchée sur le track réel).
   *
   * Le tableau reflète désormais le VRAI backlog event-sourcé du système `track`
   * (`.track/events.jsonl`, replié côté API). `GET /api/backlog` renvoie les items
   * tracés (`source: "track"`) ; en repli (sidecar absent, offline) la vue retombe
   * sur le seed ÉV statique (`source: "ev-fallback"`). Colonnes par statut dérivé
   * de la dernière `realization.transition` (done → Réalisé, in-progress → En cours,
   * cancelled/rejected → Abandonné, sinon À faire), annoté de la dernière
   * `acceptance.run`. La bande latérale porte le filtre, la légende et l'affordance
   * « Ajouter une demande » (POST /api/backlog/items, store runtime).
   */
  import { onMount } from "svelte";
  import { ListTodo, Loader, CheckCircle2, XCircle, Plus, ExternalLink, ChevronDown, ChevronRight } from "@lucide/svelte";
  import { Badge, Button, Card, Alert, EmptyState } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    BACKLOG_COLUMNS,
    backlogSeed,
    acceptanceLabel,
    statutTone,
    type BacklogItem,
    type BacklogSource,
    type BacklogStatut,
  } from "$lib/backlog/backlog-data.js";
  import { addBacklogItem, fetchBacklog } from "$lib/backlog/backlog-client.js";

  // ── État ────────────────────────────────────────────────────────────────
  /** Items effectivement affichés (track réel, ou seed ÉV en repli). */
  let items: BacklogItem[] = [...backlogSeed];
  /** Provenance des items affichés (live track vs. repli ÉV). */
  let source: BacklogSource = "ev-fallback";
  /** Filtre de colonne : null = toutes les colonnes visibles. */
  let statusFilter: BacklogStatut | null = null;
  /** Id de la carte dépliée (accordéon). */
  let expandedId: string | null = null;

  // Formulaire « Ajouter une demande »
  let showAddForm = false;
  let newTitre = "";
  let newDescription = "";
  let submitting = false;
  let formError: string | null = null;

  const COLUMN_ICONS: Record<BacklogStatut, typeof ListTodo> = {
    "a-faire": ListTodo,
    "en-cours": Loader,
    realise: CheckCircle2,
    abandonne: XCircle,
  };

  $: visibleColumns = statusFilter
    ? BACKLOG_COLUMNS.filter((c) => c.statut === statusFilter)
    : BACKLOG_COLUMNS;

  function itemsFor(statut: BacklogStatut): BacklogItem[] {
    return items.filter((i) => i.statut === statut);
  }

  function countFor(statut: BacklogStatut): number {
    return items.filter((i) => i.statut === statut).length;
  }

  function toggleExpand(id: string): void {
    expandedId = expandedId === id ? null : id;
  }

  // ── Chargement initial : track réel via l'API, sinon repli seed ───────────
  async function reload(): Promise<void> {
    try {
      const res = await fetchBacklog();
      items = res.items;
      source = res.source;
    } catch {
      // API hors ligne : on retombe sur le seed ÉV statique (démo offline).
      items = [...backlogSeed];
      source = "ev-fallback";
    }
  }

  onMount(reload);

  // ── Ajouter une demande ───────────────────────────────────────────────────
  async function submitNew(): Promise<void> {
    const titre = newTitre.trim();
    if (!titre) {
      formError = "Le titre est requis.";
      return;
    }
    submitting = true;
    formError = null;
    try {
      await addBacklogItem({
        titre,
        ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
      });
      newTitre = "";
      newDescription = "";
      showAddForm = false;
      await reload();
    } catch (error) {
      formError =
        error instanceof Error ? error.message : "Impossible d'ajouter la demande.";
    } finally {
      submitting = false;
    }
  }
</script>

<ViewLayout>
  <!-- ── Bande latérale gauche : filtre statut + légende + ajout ─────────── -->
  <svelte:fragment slot="controls">
    <div class="space-y-5 p-4">
      <!-- Filtre par statut -->
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Filtre par statut
        </p>
        <div class="space-y-1.5">
          <button
            type="button"
            class={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
              statusFilter === null
                ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-slate-50"
            }`}
            aria-current={statusFilter === null ? "true" : undefined}
            on:click={() => { statusFilter = null; }}
          >
            <span>Toutes</span>
            <span class="text-xs opacity-80">{items.length}</span>
          </button>
          {#each BACKLOG_COLUMNS as col}
            {@const Icon = COLUMN_ICONS[col.statut]}
            <button
              type="button"
              class={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                statusFilter === col.statut
                  ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-slate-50"
              }`}
              aria-current={statusFilter === col.statut ? "true" : undefined}
              on:click={() => { statusFilter = col.statut; }}
            >
              <Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
              <span class="flex-1">{col.label}</span>
              <span class="text-xs opacity-80">{countFor(col.statut)}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Légende -->
      <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Légende
        </p>
        <ul class="mt-2 space-y-1.5 text-xs text-slate-600">
          <li class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-slate-400"></span>
            À faire : demandes en attente de traitement.
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-sky-500"></span>
            En cours : évolution en développement.
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
            Réalisé : realization « done ».
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-rose-500"></span>
            Abandonné : « cancelled » / « rejected ».
          </li>
        </ul>
      </div>

      <!-- Ajouter une demande -->
      <div>
        {#if showAddForm}
          <div class="space-y-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Nouvelle demande
            </p>
            <label class="sr-only" for="backlog-titre">Titre de la demande</label>
            <input
              id="backlog-titre"
              class="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
              placeholder="Titre"
              bind:value={newTitre}
              disabled={submitting}
            />
            <label class="sr-only" for="backlog-desc">Description (optionnelle)</label>
            <textarea
              id="backlog-desc"
              class="min-h-[3rem] w-full resize-y rounded-md border border-slate-200 px-2.5 py-1.5 text-sm leading-5 text-slate-700 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
              placeholder="Description (optionnelle)"
              rows="2"
              bind:value={newDescription}
              disabled={submitting}
            ></textarea>
            {#if formError}
              <p class="text-xs text-rose-600">{formError}</p>
            {/if}
            <div class="flex gap-2">
              <Button variant="primary" size="sm" type="button" onclick={submitNew} disabled={submitting}>
                {submitting ? "Ajout…" : "Ajouter"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onclick={() => { showAddForm = false; formError = null; }}
                disabled={submitting}
              >
                Annuler
              </Button>
            </div>
          </div>
        {:else}
          <Button variant="secondary" size="sm" type="button" onclick={() => { showAddForm = true; }}>
            <Plus class="h-4 w-4" aria-hidden="true" />
            Ajouter une demande
          </Button>
        {/if}
        <p class="mt-2 text-[11px] leading-5 text-slate-400">
          Une demande ajoutée arrive en « À faire ». Le flux demande → en cours →
          réalisé est piloté par le chat (outils en suivi) ou via cette affordance.
        </p>
      </div>
    </div>
  </svelte:fragment>

  <!-- ── Contenu principal : tableau 3 colonnes ─────────────────────────── -->
  <section class="min-h-full bg-slate-50 p-6">
    <header class="mb-6">
      <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
        Évolutions du radar
      </p>
      <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
        Backlog
      </h1>
      <p class="mt-1 text-sm text-slate-500">
        Backlog réel, replié depuis le système <code class="rounded bg-slate-100 px-1 py-0.5 text-xs">track</code>
        (<code class="rounded bg-slate-100 px-1 py-0.5 text-xs">.track/events.jsonl</code>) : statut = dernière
        <code class="rounded bg-slate-100 px-1 py-0.5 text-xs">realization.transition</code>, annoté de la dernière
        <code class="rounded bg-slate-100 px-1 py-0.5 text-xs">acceptance.run</code>.
      </p>
    </header>

    <div class="mb-4">
      {#if source === "track"}
        <Alert
          tone="success"
          title="Source : sidecar track en direct"
          message="Les items ci-dessous sont repliés en direct depuis .track/events.jsonl (système track). Les demandes ajoutées via la bande gauche se superposent à cette liste."
        />
      {:else}
        <Alert
          tone="info"
          title="Source : repli ÉV (sidecar track indisponible)"
          message="Le sidecar .track/events.jsonl n'est pas accessible (offline ou non bind-monté). La vue retombe sur le seed ÉV statique, fidèle à l'historique Git mergé."
        />
      {/if}
    </div>

    <div class={`grid gap-4 ${statusFilter ? "grid-cols-1" : "md:grid-cols-2 xl:grid-cols-4"}`}>
      {#each visibleColumns as col}
        {@const Icon = COLUMN_ICONS[col.statut]}
        {@const columnItems = itemsFor(col.statut)}
        <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Icon class="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <h2 class="text-sm font-semibold text-slate-950">{col.label}</h2>
            <Badge tone={statutTone(col.statut)} class="ml-auto">{columnItems.length}</Badge>
          </div>

          <div class="space-y-2 p-3">
            {#if columnItems.length === 0}
              <EmptyState title="Aucun élément" message="Rien dans cette colonne pour l'instant." />
            {:else}
              {#each columnItems as item (item.id)}
                {@const isOpen = expandedId === item.id}
                <Card class="overflow-hidden">
                  <button
                    type="button"
                    class="flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-slate-50"
                    aria-expanded={isOpen}
                    on:click={() => toggleExpand(item.id)}
                  >
                    <span class="mt-0.5 shrink-0 text-slate-400">
                      {#if isOpen}
                        <ChevronDown class="h-4 w-4" aria-hidden="true" />
                      {:else}
                        <ChevronRight class="h-4 w-4" aria-hidden="true" />
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="flex flex-wrap items-center gap-2">
                        <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">
                          {item.code}
                        </span>
                        <Badge tone={statutTone(item.statut)}>{col.label}</Badge>
                        {#if item.acceptance && item.acceptance !== "none"}
                          <Badge tone={item.acceptance === "pass" ? "success" : "error"}>
                            acc {acceptanceLabel(item.acceptance)}
                          </Badge>
                        {/if}
                      </span>
                      <span class="mt-1 block text-sm font-medium text-slate-900">
                        {item.titre}
                      </span>
                    </span>
                  </button>

                  {#if isOpen}
                    <div class="border-t border-slate-100 px-3 py-2.5">
                      <p class="text-sm leading-6 text-slate-600">{item.description}</p>
                      <dl class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {#if item.groupe}
                          <div>
                            <dt class="inline font-semibold">Workspace :</dt>
                            <dd class="inline">{item.groupe}</dd>
                          </div>
                        {/if}
                        <div>
                          <dt class="inline font-semibold">Acceptation :</dt>
                          <dd class="inline">{acceptanceLabel(item.acceptance)}</dd>
                        </div>
                        {#if item.source}
                          <div>
                            <dt class="inline font-semibold">Source :</dt>
                            <dd class="inline">{item.source}</dd>
                          </div>
                        {/if}
                      </dl>
                      {#if item.pr !== undefined}
                        <a
                          class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline"
                          href={`https://github.com/rhanka/radar-immobilier/pull/${item.pr}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
                          PR #{item.pr}
                        </a>
                      {/if}
                    </div>
                  {/if}
                </Card>
              {/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>
</ViewLayout>
