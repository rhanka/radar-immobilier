<script lang="ts">
  import { Info, Clock, CheckCircle, AlertTriangle, Loader, ChevronDown, ChevronRight } from "@lucide/svelte";
  import { Badge } from "@sentropic/design-system-svelte";
  import type { Job, JobStatus, JobType } from "$lib/jobs/jobs-data";
  import { demoJobs, countsByStatus, filterJobsByMode } from "$lib/jobs/jobs-data.js";
  import { appMode } from "$lib/state/mode.js";
  import Acronym from "$lib/components/Acronym.svelte";
  import { getAcronym } from "$lib/glossary/acronyms.js";

  $: jobs = filterJobsByMode(demoJobs, $appMode);
  $: counts = countsByStatus(jobs);

  /** Id du job deplie dans l'accordeon (null = tous replies). */
  let expandedJobId: string | null = null;

  function toggleJob(job: Job): void {
    expandedJobId = expandedJobId === job.id ? null : job.id;
  }

  function statusBadgeTone(status: JobStatus): "neutral" | "info" | "success" | "error" {
    switch (status) {
      case "queued": return "neutral";
      case "running": return "info";
      case "done": return "success";
      case "failed": return "error";
      default: return "neutral";
    }
  }

  /** Extract the first token of a sourceRef slug and check if it's a known acronym.
   *  e.g. "cptaq-decisions" -> "CPTAQ", "ppcmoi-valleyfield" -> "PPCMOI" */
  function sourceRefAcronym(ref: string): string | null {
    const token = ref.split("-")[0].toUpperCase();
    return getAcronym(token) ? token : null;
  }

  function statusLabel(status: JobStatus): string {
    switch (status) {
      case "queued":
        return "En attente";
      case "running":
        return "En cours";
      case "done":
        return "Termine";
      case "failed":
        return "Echoue";
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
    if (ms === undefined) return "En cours";
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

  function statusDotClass(status: JobStatus): string {
    switch (status) {
      case "queued": return "bg-slate-400";
      case "running": return "bg-blue-500 animate-pulse";
      case "done": return "bg-teal-500";
      case "failed": return "bg-red-500";
      default: return "bg-slate-400";
    }
  }
</script>

<div class="space-y-5">
  <!-- Note de demo -->
  <div class="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
    <Info class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
    <p class="text-sm text-amber-900">
      <span class="font-semibold">Donnees de demo.</span>
      Les jobs affiches sont des stubs statiques (aucune orchestration reelle connectee). Le mode actif filtre les jobs de simulation.
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
      <span class="text-xs text-teal-700">Termines</span>
    </div>
    <div class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 shadow-sm">
      <AlertTriangle class="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
      <span class="text-sm font-semibold text-red-950">{counts.failed}</span>
      <span class="text-xs text-red-700">Echoues</span>
    </div>

    <!-- Badge mode actif -->
    <div class="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-2
      {$appMode === 'real' ? 'border-teal-200 bg-teal-50' : 'border-amber-200 bg-amber-50'}">
      <Clock class="h-3.5 w-3.5 {$appMode === 'real' ? 'text-teal-600' : 'text-amber-600'}" aria-hidden="true" />
      <span class="text-xs font-semibold {$appMode === 'real' ? 'text-teal-800' : 'text-amber-800'}">
        Mode : {$appMode === 'real' ? 'Reel' : 'Simulation'}
      </span>
    </div>
  </div>

  <!-- Liste des jobs en accordeon (clic = deplie le detail en place) -->
  {#if jobs.length === 0}
    <div class="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400 shadow-sm">
      Aucun job pour ce mode.
    </div>
  {:else}
    <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div class="divide-y divide-slate-100">
        {#each jobs as job (job.id)}
          {@const isExpanded = expandedJobId === job.id}
          <div>
            <!-- En-tete de carte : resume replie -->
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

              <!-- Indicateur de statut (point colore) -->
              <span class={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(job.status)}`} aria-hidden="true"></span>

              <!-- Type + source -->
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-slate-950">
                  {typeLabel(job.type)}
                </span>
                <span class="mt-0.5 block text-xs text-slate-500 font-mono">
                  {#if sourceRefAcronym(job.sourceRef)}
                    <Acronym term={sourceRefAcronym(job.sourceRef) ?? job.sourceRef} />
                    {job.sourceRef.slice((sourceRefAcronym(job.sourceRef) ?? "").length).replace(/^-/, " ")}
                  {:else}
                    {job.sourceRef}
                  {/if}
                </span>
              </span>

              <!-- Statut -->
              <Badge tone={statusBadgeTone(job.status)}>
                {statusLabel(job.status)}
              </Badge>

              <!-- Date de demarrage -->
              <span class="hidden text-xs text-slate-400 sm:block">{formatDate(job.startedAt)}</span>

              <!-- Duree -->
              <span class="hidden text-xs text-slate-500 md:block">{formatDuration(job.durationMs)}</span>

              <!-- Mode -->
              <Badge tone={job.mode === 'real' ? 'success' : 'warning'}>
                {job.mode === 'real' ? 'Reel' : 'Simulation'}
              </Badge>
            </button>

            <!-- Detail deplie en place -->
            {#if isExpanded}
              <div class="border-t border-slate-100 bg-slate-50 p-4">
                <!-- Note stub demo -->
                <div class="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <Info class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <p class="text-sm text-amber-900">
                    <span class="font-semibold">Stub de demo.</span>
                    Ce job est une donnee statique. L'orchestration reelle sera connectee a l'etape EV11.
                  </p>
                </div>

                <!-- Champs du job -->
                <dl class="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                  <div class="grid grid-cols-2 px-4 py-3">
                    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">ID</dt>
                    <dd class="text-sm font-mono text-slate-800">{job.id}</dd>
                  </div>
                  <div class="grid grid-cols-2 px-4 py-3">
                    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</dt>
                    <dd class="text-sm text-slate-800">{typeLabel(job.type)}</dd>
                  </div>
                  <div class="grid grid-cols-2 px-4 py-3">
                    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Statut</dt>
                    <dd>
                      <Badge tone={statusBadgeTone(job.status)}>
                        {statusLabel(job.status)}
                      </Badge>
                    </dd>
                  </div>
                  <div class="grid grid-cols-2 px-4 py-3">
                    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</dt>
                    <dd class="text-sm font-mono text-slate-800">{job.sourceRef}</dd>
                  </div>
                  <div class="grid grid-cols-2 px-4 py-3">
                    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Demarre</dt>
                    <dd class="text-sm text-slate-800">{formatDate(job.startedAt)}</dd>
                  </div>
                  <div class="grid grid-cols-2 px-4 py-3">
                    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Duree</dt>
                    <dd class="text-sm text-slate-800">{formatDuration(job.durationMs)}</dd>
                  </div>
                  <div class="grid grid-cols-2 px-4 py-3">
                    <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</dt>
                    <dd>
                      <Badge tone={job.mode === 'real' ? 'success' : 'warning'}>
                        {job.mode === 'real' ? 'Reel' : 'Simulation'}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
