<script lang="ts">
  import { Info, Clock, CheckCircle, AlertTriangle, Loader } from "@lucide/svelte";
  import type { JobStatus, JobType } from "$lib/jobs/jobs-data";
  import { demoJobs, countsByStatus, filterJobsByMode } from "$lib/jobs/jobs-data.js";
  import { appMode } from "$lib/state/mode.js";

  $: jobs = filterJobsByMode(demoJobs, $appMode);
  $: counts = countsByStatus(jobs);

  function statusBadgeClass(status: JobStatus): string {
    switch (status) {
      case "queued":
        return "bg-slate-100 text-slate-600";
      case "running":
        return "bg-blue-100 text-blue-700";
      case "done":
        return "bg-teal-100 text-teal-700";
      case "failed":
        return "bg-red-100 text-red-700";
      default:
        return "bg-slate-100 text-slate-600";
    }
  }

  function statusLabel(status: JobStatus): string {
    switch (status) {
      case "queued":
        return "En attente";
      case "running":
        return "En cours";
      case "done":
        return "Terminé";
      case "failed":
        return "Échoué";
      default:
        return status;
    }
  }

  function typeLabel(type: JobType): string {
    switch (type) {
      case "ingestion":
        return "Ingestion";
      case "scan":
        return "Scan";
      case "scoring":
        return "Scoring";
      case "backfill":
        return "Backfill";
      default:
        return type;
    }
  }

  function formatDuration(ms?: number): string {
    if (ms === undefined) return "—";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
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
  <!-- Note de démo -->
  <div class="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
    <Info class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
    <p class="text-sm text-amber-900">
      <span class="font-semibold">Données de démo.</span>
      Les jobs affichés sont des stubs statiques — aucune orchestration réelle n'est connectée pour ÉV6. Le mode actif filtre les jobs de simulation.
    </p>
  </div>

  <!-- Chips de statut -->
  <div class="flex flex-wrap gap-3">
    <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <span class="h-2.5 w-2.5 rounded-full bg-slate-400"></span>
      <span class="text-sm font-semibold text-slate-950">{counts.queued}</span>
      <span class="text-xs text-slate-500">En attente</span>
    </div>
    <div class="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 shadow-sm">
      <Loader class="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-blue-950">{counts.running}</span>
      <span class="text-xs text-blue-700">En cours</span>
    </div>
    <div class="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 shadow-sm">
      <CheckCircle class="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-teal-950">{counts.done}</span>
      <span class="text-xs text-teal-700">Terminés</span>
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

  <!-- Table des jobs -->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th class="px-4 py-2.5">Type</th>
            <th class="px-3 py-2.5">Source</th>
            <th class="px-3 py-2.5">Statut</th>
            <th class="px-3 py-2.5">Démarré</th>
            <th class="px-3 py-2.5">Durée</th>
            <th class="px-3 py-2.5">Mode</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each jobs as job}
            <tr class="hover:bg-slate-50">
              <td class="px-4 py-2.5 font-medium text-slate-950">
                {typeLabel(job.type)}
              </td>
              <td class="px-3 py-2.5 text-xs text-slate-600 font-mono">{job.sourceRef}</td>
              <td class="px-3 py-2.5">
                <span class={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(job.status)}`}>
                  {statusLabel(job.status)}
                </span>
              </td>
              <td class="px-3 py-2.5 text-xs text-slate-500">{formatDate(job.startedAt)}</td>
              <td class="px-3 py-2.5 text-xs text-slate-500">{formatDuration(job.durationMs)}</td>
              <td class="px-3 py-2.5">
                <span class={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${job.mode === 'real' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}`}>
                  {job.mode === 'real' ? 'Réel' : 'Simulation'}
                </span>
              </td>
            </tr>
          {/each}
          {#if jobs.length === 0}
            <tr>
              <td colspan="6" class="px-4 py-6 text-center text-sm text-slate-400">
                Aucun job pour ce mode.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
