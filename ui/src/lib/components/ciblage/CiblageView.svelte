<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, Badge, Button, Card, EmptyState } from "@sentropic/design-system-svelte";
  import { Plus, Pencil, Trash2, Rocket, Target } from "@lucide/svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    CIBLAGE_CADENCES,
    CIBLAGE_CITIES,
    cadenceLabel,
    cityLabel,
    createPlan,
    deletePlan,
    emptyForm,
    fetchCiblage,
    formFromPlan,
    groupBindingsByKind,
    isFormValid,
    toggleIn,
    updatePlan,
    type CiblagePlanFormV,
    type CiblagePlanV,
    type SourceBindingV,
  } from "$lib/ciblage/ciblage.js";

  // ── State ────────────────────────────────────────────────────────────────────
  let plans: CiblagePlanV[] = [];
  let sourceBindings: SourceBindingV[] = [];
  let loading = true;
  let loadError: string | null = null;

  let editingId: string | null = null; // null = creating, else editing this plan
  let form: CiblagePlanFormV = emptyForm();
  let formOpen = false;
  let saving = false;
  let saveError: string | null = null;

  $: bindingGroups = groupBindingsByKind(sourceBindings);
  $: canSave = isFormValid(form);

  async function load(): Promise<void> {
    loading = true;
    const res = await fetchCiblage();
    loading = false;
    if (res.kind === "error") {
      loadError = res.detail;
      return;
    }
    loadError = null;
    plans = res.plans;
    sourceBindings = res.sourceBindings;
  }

  function startCreate(): void {
    editingId = null;
    form = emptyForm();
    saveError = null;
    formOpen = true;
  }

  function startEdit(plan: CiblagePlanV): void {
    editingId = plan.id;
    form = formFromPlan(plan);
    saveError = null;
    formOpen = true;
  }

  function cancelForm(): void {
    formOpen = false;
    saveError = null;
  }

  function toggleCity(slug: string): void {
    form = { ...form, citySlugs: toggleIn(form.citySlugs, slug) };
  }

  function toggleBinding(sourceId: string): void {
    form = { ...form, sourceBindingIds: toggleIn(form.sourceBindingIds, sourceId) };
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    saveError = null;
    const res = editingId
      ? await updatePlan(editingId, form)
      : await createPlan(form);
    saving = false;
    if (!res.ok) {
      saveError = res.detail;
      return;
    }
    formOpen = false;
    await load();
  }

  async function remove(plan: CiblagePlanV): Promise<void> {
    const ok = await deletePlan(plan.id);
    if (ok.ok) await load();
  }

  onMount(load);
</script>

<ViewLayout>
  <!-- ── Bande latérale : nouveau plan + repères pipeline ───────────────────── -->
  <svelte:fragment slot="controls">
    <div class="space-y-5 p-4">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Ciblage (étape 1/3)
        </p>
        <Button variant="primary" size="sm" type="button" onclick={startCreate}>
          <Plus class="h-4 w-4" aria-hidden="true" />
          Nouveau plan de ciblage
        </Button>
      </div>

      <div class="space-y-2 border-t border-slate-100 pt-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Pipeline
        </p>
        <ol class="space-y-1.5 text-sm text-slate-600">
          <li class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-teal-500"></span>
            <span class="font-semibold text-slate-900">Ciblage</span> : déclarer quoi collecter
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-slate-300"></span>
            Recueil : exécuter la collecte (lot suivant)
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-slate-300"></span>
            Exploitation : modéliser + réconcilier
          </li>
        </ol>
      </div>

      <div class="border-t border-slate-100 pt-3">
        <p class="text-xs leading-5 text-slate-400">
          Un plan est une <span class="font-semibold text-slate-600">déclaration pure</span> :
          l'enregistrer ne déclenche AUCUNE collecte. L'identifiant du plan sera
          inscrit sur chaque document brut collecté (<code class="rounded bg-slate-100 px-1 text-[11px]">ciblagePlanId</code>)
          par l'exécution recueil (lot suivant).
        </p>
      </div>
    </div>
  </svelte:fragment>

  <!-- ── Contenu principal ────────────────────────────────────────────────────── -->
  <section class="min-h-full bg-slate-50 p-6">
    <header class="mb-4">
      <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
        Pipeline · étape 1 · Ciblage
      </p>
      <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
        Plans de ciblage
      </h1>
      <p class="mt-2 max-w-prose rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
        Déclarez <span class="font-semibold text-slate-800">ce que</span> le radar
        doit collecter : villes pilotes, sources réelles du catalogue
        <code class="rounded bg-slate-100 px-1 text-xs">prioritySources</code>, et
        cadence. Aucune donnée fabriquée, aucune I/O : enregistrer un plan ne
        lance pas de collecte (le recueil est le lot suivant).
      </p>
    </header>

    <!-- ── Formulaire création / édition ─────────────────────────────────────── -->
    {#if formOpen}
      <Card class="mb-6 overflow-hidden">
        <div class="space-y-4 p-4">
          <div class="flex items-center gap-2">
            <Target class="h-4 w-4 text-teal-600" aria-hidden="true" />
            <h2 class="text-sm font-semibold text-slate-900">
              {editingId ? "Modifier le plan" : "Nouveau plan de ciblage"}
            </h2>
          </div>

          <!-- Libellé -->
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500" for="ciblage-label">
              Libellé
            </label>
            <input
              id="ciblage-label"
              class="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
              placeholder="ex. Veille Valleyfield, avis publics"
              bind:value={form.label}
              disabled={saving}
            />
          </div>

          <!-- Villes -->
          <fieldset>
            <legend class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Villes ciblées
            </legend>
            <div class="flex flex-wrap gap-2">
              {#each CIBLAGE_CITIES as city (city.slug)}
                <button
                  type="button"
                  aria-pressed={form.citySlugs.includes(city.slug)}
                  class={`rounded-full border px-3 py-1 text-sm transition ${
                    form.citySlugs.includes(city.slug)
                      ? "border-teal-400 bg-teal-50 text-teal-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  onclick={() => toggleCity(city.slug)}
                  disabled={saving}
                >
                  {city.label}
                </button>
              {/each}
            </div>
          </fieldset>

          <!-- Sources (catalogue réel, groupé par kind) -->
          <fieldset>
            <legend class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sources (catalogue prioritySources)
            </legend>
            {#if bindingGroups.length === 0}
              <p class="text-sm text-slate-400">Catalogue de sources indisponible.</p>
            {:else}
              <div class="space-y-3">
                {#each bindingGroups as group (group.kind)}
                  <div>
                    <p class="mb-1 text-xs font-medium text-slate-500">{group.kind}</p>
                    <div class="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                      {#each group.bindings as b (b.sourceId)}
                        <label
                          class={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition ${
                            form.sourceBindingIds.includes(b.sourceId)
                              ? "border-teal-300 bg-teal-50"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
                            checked={form.sourceBindingIds.includes(b.sourceId)}
                            onchange={() => toggleBinding(b.sourceId)}
                            disabled={saving}
                          />
                          <span class="truncate text-slate-700" title={b.sourceId}>{b.sourceId}</span>
                          {#if b.city}
                            <Badge tone="neutral" class="ml-auto">{cityLabel(b.city)}</Badge>
                          {/if}
                        </label>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </fieldset>

          <!-- Cadence -->
          <fieldset>
            <legend class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Cadence (automatisation)
            </legend>
            <div class="flex flex-wrap gap-2">
              {#each CIBLAGE_CADENCES as cad (cad.value)}
                <button
                  type="button"
                  aria-pressed={form.cadence === cad.value}
                  title={cad.hint}
                  class={`rounded-md border px-3 py-1.5 text-sm transition ${
                    form.cadence === cad.value
                      ? "border-teal-400 bg-teal-50 text-teal-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  onclick={() => (form = { ...form, cadence: cad.value })}
                  disabled={saving}
                >
                  {cad.label}
                </button>
              {/each}
            </div>
          </fieldset>

          <!-- Activé -->
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
              bind:checked={form.enabled}
              disabled={saving}
            />
            Activé (un recueil ultérieur pourra consommer ce plan)
          </label>

          <!-- Notes -->
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500" for="ciblage-notes">
              Notes (optionnel)
            </label>
            <textarea
              id="ciblage-notes"
              class="min-h-[3rem] w-full resize-y rounded-md border border-slate-200 px-2.5 py-1.5 text-sm leading-5 text-slate-700 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
              rows="2"
              bind:value={form.notes}
              disabled={saving}
            ></textarea>
          </div>

          {#if saveError}
            <Alert tone="warning" title="Enregistrement impossible" message={saveError} />
          {/if}

          <div class="flex items-center gap-2">
            <Button variant="primary" size="sm" type="button" onclick={save} disabled={!canSave || saving}>
              {saving ? "Enregistrement…" : editingId ? "Enregistrer les modifications" : "Créer le plan"}
            </Button>
            <Button variant="ghost" size="sm" type="button" onclick={cancelForm} disabled={saving}>
              Annuler
            </Button>
            <!-- Affordance différée : la collecte est le lot suivant (recueil). -->
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled
              title="Exécution du recueil à venir (lot suivant) : un plan ne déclenche aucune collecte"
              class="ml-auto"
            >
              <Rocket class="h-4 w-4" aria-hidden="true" />
              Lancer la collecte (à venir)
            </Button>
          </div>
        </div>
      </Card>
    {/if}

    <!-- ── Liste des plans ───────────────────────────────────────────────────── -->
    {#if loading}
      <div class="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
        Chargement des plans de ciblage…
      </div>
    {:else if loadError}
      <Alert tone="warning" title="Impossible de charger les plans" message={loadError} />
    {:else if plans.length === 0}
      <EmptyState
        title="Aucun plan de ciblage"
        message="Déclarez un premier plan : choisissez les villes, les sources réelles du catalogue et la cadence. Aucune collecte n'est lancée à l'enregistrement."
      >
        {#snippet action()}
          <Button variant="primary" size="sm" onclick={startCreate}>
            <Plus class="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nouveau plan de ciblage
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {#each plans as plan (plan.id)}
          <Card class="overflow-hidden">
            <div class="space-y-3 p-4">
              <div class="flex items-start gap-2">
                <div class="min-w-0">
                  <h3 class="truncate text-sm font-semibold text-slate-900" title={plan.label}>
                    {plan.label}
                  </h3>
                  <p class="mt-0.5 text-xs text-slate-400">id : {plan.id}</p>
                </div>
                <Badge tone={plan.enabled ? "success" : "neutral"} class="ml-auto shrink-0">
                  {plan.enabled ? "activé" : "désactivé"}
                </Badge>
              </div>

              <div class="flex flex-wrap items-center gap-1.5">
                <Badge tone="info">{cadenceLabel(plan.cadence)}</Badge>
                {#each plan.citySlugs as slug}
                  <Badge tone="neutral">{cityLabel(slug)}</Badge>
                {/each}
              </div>

              <div>
                <p class="text-xs font-medium text-slate-500">
                  {plan.sourceBindingIds.length} source{plan.sourceBindingIds.length !== 1 ? "s" : ""} ciblée{plan.sourceBindingIds.length !== 1 ? "s" : ""}
                </p>
                <ul class="mt-1 space-y-0.5">
                  {#each plan.sourceBindingIds as sid}
                    <li class="truncate font-mono text-xs text-slate-500" title={sid}>{sid}</li>
                  {/each}
                </ul>
              </div>

              {#if plan.notes}
                <p class="rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs text-slate-500">
                  {plan.notes}
                </p>
              {/if}

              <div class="flex items-center gap-1.5 border-t border-slate-100 pt-2">
                <Button variant="secondary" size="sm" type="button" onclick={() => startEdit(plan)}>
                  <Pencil class="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Modifier
                </Button>
                <Button variant="ghost" size="sm" type="button" onclick={() => remove(plan)}>
                  <Trash2 class="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Supprimer
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled
                  title="Exécution du recueil à venir (lot suivant)"
                  class="ml-auto"
                >
                  <Rocket class="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Lancer (à venir)
                </Button>
              </div>
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </section>
</ViewLayout>
