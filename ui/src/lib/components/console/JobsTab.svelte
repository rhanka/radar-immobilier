<script lang="ts">
  import { onMount } from "svelte";
  import { Info, Clock, CheckCircle, AlertTriangle, Loader, ChevronDown, ChevronRight, RefreshCw } from "@lucide/svelte";
  import { Badge } from "@sentropic/design-system-svelte";
  import { appMode } from "$lib/state/mode.js";
  import {
    fetchPipelineJobs,
    filterPipelineJobsByMode,
    pipelineStatusCounts,
    jobStatusLabel,
    stepStatusLabel,
    jobDuration,
    type PipelineJob,
    type PipelineJobStatus,
    type PipelineStepStatus,
  } from "$lib/jobs/pipeline-jobs.js";

  // Real jobs produced by the pipeline executor (POST /api/ciblage/:id/run).
  let allJobs: PipelineJob[] = [];
  let loading = true;
  let loadError: string | null = null;

  $: jobs = filterPipelineJobsByMode(allJobs, $appMode);
  $: counts = pipelineStatusCounts(jobs);

  /** Id du job déplié dans l'accordéon (null = tous repliés). */
  let expandedJobId: string | null = null;

  async function load(): Promise<void> {
    loading = true;
    const res = await fetchPipelineJobs();
    loading = false;
    if (res.kind === "error") {
      loadError = res.detail;
      return;
    }
    loadError = null;
    allJobs = res.jobs;
  }

  onMount(load);

  function toggleJob(job: PipelineJob): void {
    expandedJobId = expandedJobId === job.id ? null : job.id;
  }

  function statusBadgeTone(
    status: PipelineJobStatus,
  ): "neutral" | "info" | "success" | "warning" | "error" {
    switch (status) {
      case "running": return "info";
      case "succeeded": return "success";
      case "partial": return "warning";
      case "failed": return "error";
      default: return "neutral";
    }
  }

  function stepBadgeTone(
    status: PipelineStepStatus,
  ): "neutral" | "success" | "error" {
    switch (status) {
      case "succeeded": return "success";
      case "failed": return "error";
      case "skipped": return "neutral";
      default: return "neutral";
    }
  }

  function statusDotClass(status: PipelineJobStatus): string {
    switch (status) {
      case "running": return "bg-blue-500 animate-pulse";
      case "succeeded": return "bg-teal-500";
      case "partial": return "bg-amber-500";
      case "failed": return "bg-red-500";
      default: return "bg-slate-400";
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("fr-CA", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
</script>

<div class="space-y-5">
  <!-- Bandeau : jobs réels du pipeline -->
  <div class="flex items-start justify-between gap-3">
    <div class="flex gap-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
      <Info class="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
      <p class="text-sm text-teal-900">
        <span class="font-semibold">Jobs réels.</span>
        Exécutions du pipeline recueil → exploitation déclenchées depuis un plan de
        ciblage (« Lancer la collecte »). Le mode actif filtre les jobs de simulation.
      </p>
    </div>
    <button
      type="button"
      class="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:bg-slate-50"
      on:click={load}
      disabled={loading}
    >
      <RefreshCw class={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      Rafraîchir
    </button>
  </div>

  <!-- Chips de statut -->
  <div class="flex flex-wrap gap-3">
    <div class="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 shadow-sm">
      <Loader class="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-blue-950">{counts.running}</span>
      <span class="text-xs text-blue-700">En cours</span>
    </div>
    <div class="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 shadow-sm">
      <CheckCircle class="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-teal-950">{counts.succeeded}</span>
      <span class="text-xs text-teal-700">Réussis</span>
    </div>
    <div class="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 shadow-sm">
      <AlertTriangle class="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-amber-950">{counts.partial}</span>
      <span class="text-xs text-amber-700">Partiels</span>
    </div>
    <div class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 shadow-sm">
      <AlertTriangle class="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-red-950">{counts.failed}</span>
      <span class="text-xs text-red-700">Échoués</span>
    </div>

    <!-- Badge mode actif -->
    <div class="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-2
      {$appMode === 'real' ? 'border-teal-200 bg-teal-50' : 'border-amber-200 bg-amber-50'}">
      <Clock class="h-3.5 w-3.5 {$appMode === 'real' ? 'text-teal-600' : 'text-amber-600'}" aria-hidden="true" />
      <span class="text-xs font-semibold {$appMode === 'real' ? 'text-teal-800' : 'text-amber-800'}">
        Mode : {$appMode === 'real' ? 'Réel' : 'Simulation'}
      </span>
    </div>
  </div>

  <!-- Liste des jobs -->
  {#if loading}
    <div class="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400 shadow-sm">
      Chargement des jobs…
    </div>
  {:else if loadError}
    <div class="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p class="text-sm text-amber-900">
        <span class="font-semibold">Jobs indisponibles.</span> {loadError}
      </p>
    </div>
  {:else if jobs.length === 0}
    <div class="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400 shadow-sm">
      Aucun job pour ce mode. Lancez une collecte depuis un plan de ciblage.
    </div>
  {:else}
    <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div class="divide-y divide-slate-100">
        {#each jobs as job (job.id)}
          {@const isExpanded = expandedJobId === job.id}
          <div>
            <!-- En-tête : résumé replié -->
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
              aria-expanded={isExpanded}
              on:click={() => toggleJob(job)}
            >
              <span class="shrink-0 text-slate-400">
                {#if isExpanded}
                  <ChevronDown class="h-4 w-4" aria-hidden="true" />
                {:else}
                  <ChevronRight class="h-4 w-4" aria-hidden="true" />
                {/if}
              </span>

              <span class={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(job.status)}`} aria-hidden="true"></span>

              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-slate-950">
                  {job.planLabel || job.planId}
                </span>
                <span class="mt-0.5 block font-mono text-xs text-slate-500">
                  {job.totals.sources} source{job.totals.sources !== 1 ? "s" : ""}
                  · {job.totals.rawDocs} doc{job.totals.rawDocs !== 1 ? "s" : ""}
                  · {job.totals.mentions} mention{job.totals.mentions !== 1 ? "s" : ""}
                </span>
              </span>

              <Badge tone={statusBadgeTone(job.status)}>
                {jobStatusLabel(job.status)}
              </Badge>

              <span class="hidden text-xs text-slate-400 sm:block">{formatDate(job.startedAt)}</span>
              <span class="hidden text-xs text-slate-500 md:block">{jobDuration(job)}</span>

              <Badge tone={job.mode === 'real' ? 'success' : 'warning'}>
                {job.mode === 'real' ? 'Réel' : 'Simulation'}
              </Badge>
            </button>

            <!-- Détail : étapes par source / ville / comptes -->
            {#if isExpanded}
              <div class="border-t border-slate-100 bg-slate-50 p-4">
                <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
                  <thead>
                    <tr class="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th class="px-3 py-2 font-semibold">Source</th>
                      <th class="px-3 py-2 font-semibold">Ville</th>
                      <th class="px-3 py-2 font-semibold">Statut</th>
                      <th class="px-3 py-2 text-right font-semibold">Docs</th>
                      <th class="px-3 py-2 text-right font-semibold">Mentions</th>
                      <th class="px-3 py-2 font-semibold">Détail</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    {#each job.steps as step (step.sourceId + step.city)}
                      <tr>
                        <td class="px-3 py-2 font-mono text-xs text-slate-700">{step.sourceId}</td>
                        <td class="px-3 py-2 text-slate-600">{step.city}</td>
                        <td class="px-3 py-2">
                          <Badge tone={stepBadgeTone(step.status)}>
                            {stepStatusLabel(step.status)}
                          </Badge>
                        </td>
                        <td class="px-3 py-2 text-right text-slate-700">{step.rawDocIds.length}</td>
                        <td class="px-3 py-2 text-right text-slate-700">{step.mentionCount ?? "·"}</td>
                        <td class="px-3 py-2 text-xs text-slate-500">
                          {#if step.error}
                            <span class="text-red-600">{step.error}</span>
                          {:else if step.skippedReason}
                            <span class="text-slate-400">{step.skippedReason}</span>
                          {:else}
                            ·
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                <p class="mt-2 text-xs text-slate-400">
                  Job <code class="rounded bg-white px-1 font-mono text-[11px]">{job.id}</code>
                  · plan <code class="rounded bg-white px-1 font-mono text-[11px]">{job.planId}</code>
                </p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
