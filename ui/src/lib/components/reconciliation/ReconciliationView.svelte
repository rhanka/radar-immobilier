<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, Badge, Button, Card, EmptyState, Select } from "@sentropic/design-system-svelte";
  import { Check, X, Database } from "@lucide/svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    STUDIO_CITIES,
    groupEntitiesByType,
    studioCounts,
    candidateSharedTerms,
    legalStatusTargets,
    statusDisplayLabel,
    shortRawRef,
    fetchCityState,
    seedCity,
    applyOntologyPatch,
    resolveWriteToken,
    type OntologyCityState,
    type FetchCityStateResult,
    type CandidateV,
    type CanonicalEntityV,
  } from "$lib/ontology/reconciliation.js";

  // ── State ────────────────────────────────────────────────────────────────────
  let citySlug: string = STUDIO_CITIES[0]!.slug;
  let result: FetchCityStateResult | null = null;
  let loading = false;
  let seeding = false;

  // Write-core: the studio is writable only when a token is env-injected
  // (VITE_RADAR_ONTOLOGY_WRITE_TOKEN). No secret is ever hardcoded here.
  const writeToken = resolveWriteToken();
  const canWrite = writeToken !== undefined;
  // Per-candidate in-flight id (disables its buttons while the patch posts).
  let pendingCandidateId: string | null = null;
  // Per-canonical in-flight id (disables its set_status control while it posts).
  let pendingCanonicalId: string | null = null;
  let writeError: string | null = null;

  async function load(slug: string): Promise<void> {
    loading = true;
    result = await fetchCityState(slug);
    loading = false;
  }

  async function handleSeed(): Promise<void> {
    seeding = true;
    const r = await seedCity(citySlug);
    seeding = false;
    if (r.ok) await load(citySlug);
  }

  /**
   * Accept or reject a candidate appariement → POST the matching
   * `graphify_ontology_patch_v1` op, then patch the local read-model from the
   * route's re-derived response (no full refetch needed).
   */
  async function decide(
    cand: CandidateV,
    op: "accept_match" | "reject_match",
  ): Promise<void> {
    if (!canWrite || pendingCandidateId) return;
    pendingCandidateId = cand.id;
    writeError = null;
    const res = await applyOntologyPatch(
      citySlug,
      { op, aId: cand.candidate_id, bId: cand.canonical_id },
      writeToken,
    );
    pendingCandidateId = null;
    if (res.kind === "ok" && result && result.kind === "ok") {
      result = {
        kind: "ok",
        state: {
          ...(result.state as OntologyCityState),
          entities: res.applied.entities,
          candidates: res.applied.candidates,
        },
      };
    } else if (res.kind === "unauthorized") {
      writeError = "Écriture refusée : jeton manquant ou invalide.";
    } else if (res.kind === "error") {
      writeError = res.detail;
    }
  }

  /**
   * Override a canonical's reconciliation status (set_status) → POST the
   * `graphify_ontology_patch_v1` op, then patch the local read-model from the
   * route's re-derived response. `to` is one of the D3-legal targets for the
   * canonical's current status (the API re-validates the transition server-side).
   */
  async function setStatus(
    entity: CanonicalEntityV,
    to: string,
  ): Promise<void> {
    if (!canWrite || pendingCanonicalId || !to) return;
    pendingCanonicalId = entity.id;
    writeError = null;
    const res = await applyOntologyPatch(
      citySlug,
      { op: "set_status", canonicalId: entity.id, from: entity.status, to },
      writeToken,
    );
    pendingCanonicalId = null;
    if (res.kind === "ok" && result && result.kind === "ok") {
      result = {
        kind: "ok",
        state: {
          ...(result.state as OntologyCityState),
          entities: res.applied.entities,
          candidates: res.applied.candidates,
        },
      };
    } else if (res.kind === "unauthorized") {
      writeError = "Écriture refusée : jeton manquant ou invalide.";
    } else if (res.kind === "error") {
      writeError = res.detail;
    }
  }

  // Reload whenever the selected city changes (skips re-entrant loads).
  let loadedCity: string | null = null;
  $: if (citySlug !== loadedCity && !loading) {
    loadedCity = citySlug;
    void load(citySlug);
  }

  onMount(() => {
    loadedCity = citySlug;
    void load(citySlug);
  });

  // ── Derived ───────────────────────────────────────────────────────────────────
  $: state =
    result && result.kind === "ok" ? (result.state as OntologyCityState) : null;
  $: groups = state ? groupEntitiesByType(state.entities) : [];
  $: counts = state ? studioCounts(state) : null;
  $: cityLabel =
    STUDIO_CITIES.find((c) => c.slug === citySlug)?.label ?? citySlug;

  function statusTone(status: string): "success" | "neutral" | "error" {
    if (status === "validated") return "success";
    if (status === "rejected") return "error";
    return "neutral";
  }

  // Shared French label for a reconciliation status (lock-step with the helper).
  const statusLabel = statusDisplayLabel;
</script>

<ViewLayout>
  <!-- ── Bande latérale : sélecteur de ville + compteurs ─────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="space-y-5 p-4">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Ville (projet par ville)
        </p>
        <Select
          id="reconciliation-city"
          label="Ville du projet ontologie"
          bind:value={citySlug}
        >
          {#each STUDIO_CITIES as c}
            <option value={c.slug}>{c.label}</option>
          {/each}
        </Select>
      </div>

      {#if counts}
        <div class="space-y-2 border-t border-slate-100 pt-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            État du projet
          </p>
          <dl class="space-y-1 text-sm text-slate-600">
            <div class="flex items-center justify-between">
              <dt>Entités canoniques</dt>
              <dd class="font-semibold text-slate-900">{counts.entityCount}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt>dont validées</dt>
              <dd class="font-semibold text-teal-700">{counts.validatedCount}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt>Candidats (entity_match)</dt>
              <dd class="font-semibold text-slate-900">{counts.candidateCount}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt>Mentions brutes</dt>
              <dd class="font-semibold text-slate-900">{counts.mentionCount}</dd>
            </div>
          </dl>
        </div>
      {/if}

      <div class="border-t border-slate-100 pt-3">
        {#if canWrite}
          <p class="text-xs leading-5 text-slate-400">
            Écriture activée. Accepter / rejeter un appariement persiste une
            décision <code class="rounded bg-slate-100 px-1 text-xs">graphify_ontology_patch_v1</code>
            (route protégée par jeton) puis re-réconcilie l'état.
          </p>
        {:else}
          <p class="text-xs leading-5 text-slate-400">
            Lecture seule. L'écriture (accepter / rejeter un appariement) passe par
            le cœur write-guarded du studio, activé par un jeton
            (<code class="rounded bg-slate-100 px-1 text-xs">x-radar-write-token</code>)
            non configuré dans cet environnement.
          </p>
        {/if}
      </div>
    </div>
  </svelte:fragment>

  <!-- ── Contenu principal ────────────────────────────────────────────────────── -->
  <section class="min-h-full bg-slate-50 p-6">
    <header class="mb-4">
      <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
        Studio de réconciliation (ontologie graphify)
      </p>
      <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
        Réconciliation : {cityLabel}
      </h1>
      <p class="mt-2 max-w-prose rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
        État du projet graphify <span class="font-semibold text-slate-800">par ville</span>
        (D1) : entités canoniques par type, file de candidats
        <code class="rounded bg-slate-100 px-1 text-xs">entity_match</code>
        et mentions brutes avec leur provenance S3. Données
        <span class="font-semibold text-teal-700">réelles</span> issues des rôles,
        avis publics, adresses et règlements (données réelles ; aucune donnée
        fabriquée ; propriétaire jamais exposé, Loi 25).
      </p>
    </header>

    {#if loading}
      <div class="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
        Chargement de l'état du projet…
      </div>
    {:else if result && result.kind === "error"}
      <Alert
        tone="warning"
        title="Impossible de charger l'état du projet"
        message={result.detail}
      />
    {:else if result && result.kind === "empty"}
      <EmptyState
        title="Aucun état de projet pour cette ville"
        message="Aucune donnée réconciliée n'est encore persistée. Lancez l'exploitation des échantillons réels (rôle MAMH) pour peupler le studio."
      >
        {#snippet action()}
          <Button variant="primary" size="sm" onclick={handleSeed} disabled={seeding}>
            <Database class="mr-1.5 h-4 w-4" aria-hidden="true" />
            {seeding ? "Exploitation en cours…" : "Exploiter les échantillons réels"}
          </Button>
        {/snippet}
      </EmptyState>
    {:else if state && counts}
      <!-- ── Entités canoniques par type ──────────────────────────────────────── -->
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Entités canoniques
      </h2>
      {#if groups.length === 0}
        <div class="mb-6 rounded-lg border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-400">
          Aucune entité canonique réconciliée.
        </div>
      {:else}
        <div class="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#each groups as group (group.type)}
            <Card class="overflow-hidden">
              <div class="p-3">
                <div class="mb-2 flex items-center gap-2">
                  <span class="text-sm font-semibold text-slate-900">{group.type}</span>
                  <Badge tone="neutral" class="ml-auto">{group.entities.length}</Badge>
                </div>
                <ul class="space-y-1.5">
                  {#each group.entities as e (e.id)}
                    <li class="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
                      <div class="flex items-center gap-1.5">
                        <span class="truncate text-sm text-slate-800" title={e.label}>
                          {e.label}
                        </span>
                        <Badge tone={statusTone(e.status)} class="ml-auto">
                          {statusLabel(e.status)}
                        </Badge>
                      </div>
                      {#if e.aliases.length > 0}
                        <p class="mt-0.5 text-xs text-slate-400">
                          alias : {e.aliases.join(", ")}
                        </p>
                      {/if}
                      <p class="mt-0.5 truncate text-xs text-slate-400" title={e.evidenceRefs.join(", ")}>
                        {e.evidenceRefs.length} preuve{e.evidenceRefs.length !== 1 ? "s" : ""}
                      </p>
                      {#if canWrite && legalStatusTargets(e.status).length > 0}
                        <!-- set_status control: change the canonical's reconciliation
                             status to a D3-legal target (re-validated server-side). -->
                        <div class="mt-1.5 flex items-center gap-1.5">
                          <label
                            class="sr-only"
                            for={`set-status-${e.id}`}
                          >
                            Statut de {e.label}
                          </label>
                          <select
                            id={`set-status-${e.id}`}
                            class="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:opacity-50"
                            disabled={pendingCanonicalId !== null}
                            title="Changer le statut de réconciliation (set_status)"
                            value=""
                            onchange={(ev) => {
                              const sel = ev.currentTarget;
                              const to = sel.value;
                              sel.value = "";
                              if (to) void setStatus(e, to);
                            }}
                          >
                            <option value="" disabled>Changer le statut…</option>
                            {#each legalStatusTargets(e.status) as target}
                              <option value={target}>→ {statusLabel(target)}</option>
                            {/each}
                          </select>
                        </div>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
            </Card>
          {/each}
        </div>
      {/if}

      <!-- ── File de candidats (entity_match) ─────────────────────────────────── -->
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        File de candidats (entity_match)
      </h2>
      {#if writeError}
        <div class="mb-3">
          <Alert tone="warning" title="Décision non appliquée" message={writeError} />
        </div>
      {/if}
      {#if state.candidates.length === 0}
        <div class="mb-6 rounded-lg border border-slate-200 bg-white px-6 py-6 text-center text-sm text-slate-400">
          Aucun candidat d'appariement en attente (les rôles MAMH se réconcilient
          sur une clé provinciale unique par lot/matricule).
        </div>
      {:else}
        <div class="mb-6 space-y-2">
          {#each state.candidates as cand (cand.id)}
            <Card class="overflow-hidden">
              <div class="flex flex-wrap items-center gap-2 p-3">
                <span class="text-sm text-slate-700">{cand.candidate_id}</span>
                <span class="text-slate-300">→</span>
                <span class="text-sm font-medium text-slate-900">{cand.canonical_id}</span>
                {#if cand.score !== undefined}
                  <Badge tone="info">score {cand.score.toFixed(2)}</Badge>
                {/if}
                {#each candidateSharedTerms(cand) as term}
                  <Badge tone="neutral">{term}</Badge>
                {/each}
                <div class="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canWrite || pendingCandidateId !== null}
                    title={canWrite
                      ? "Accepter l'appariement (fusion canonique)"
                      : "Écriture désactivée : aucun jeton configuré"}
                    onclick={() => decide(cand, "accept_match")}
                  >
                    <Check class="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Accepter
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canWrite || pendingCandidateId !== null}
                    title={canWrite
                      ? "Rejeter l'appariement (jamais fusionné)"
                      : "Écriture désactivée : aucun jeton configuré"}
                    onclick={() => decide(cand, "reject_match")}
                  >
                    <X class="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Rejeter
                  </Button>
                </div>
              </div>
            </Card>
          {/each}
        </div>
      {/if}

      <!-- ── Mentions brutes + provenance ─────────────────────────────────────── -->
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Mentions brutes (provenance S3)
      </h2>
      {#if state.mentions.length === 0}
        <div class="rounded-lg border border-slate-200 bg-white px-6 py-6 text-center text-sm text-slate-400">
          Aucune mention extraite.
        </div>
      {:else}
        <div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-3 py-2 font-semibold">Type</th>
                <th class="px-3 py-2 font-semibold">Libellé</th>
                <th class="px-3 py-2 font-semibold">Termes normalisés</th>
                <th class="px-3 py-2 font-semibold">Preuve (raw S3)</th>
              </tr>
            </thead>
            <tbody>
              {#each state.mentions as m (m.id)}
                <tr class="border-t border-slate-100">
                  <td class="px-3 py-2"><Badge tone="neutral">{m.type}</Badge></td>
                  <td class="px-3 py-2 text-slate-800">{m.label}</td>
                  <td class="px-3 py-2 text-slate-500">{m.normalized_terms.join(", ")}</td>
                  <td class="px-3 py-2 text-slate-400">
                    {#each m.source_refs as ref}
                      <span class="block truncate font-mono text-xs" title={ref}>
                        {shortRawRef(ref)}
                      </span>
                    {/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <div class="mt-6">
        <Alert
          tone="info"
          title="Provenance"
          message="État du projet réconcilié à {state.generatedAt} (profil {state.profileHash.slice(0, 12)}…). Entités issues des rôles, avis publics, adresses et règlements (données réelles) ; aucune donnée illustrative dans cet écran."
        />
      </div>
    {/if}
  </section>
</ViewLayout>
