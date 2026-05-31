<script lang="ts">
  import { BarChart2 } from "@lucide/svelte";
  import { valleyfieldDossiers } from "@radar/domain";
  import { sourceContributions } from "$lib/sources/contribution.js";
  import { getAcronym } from "$lib/glossary/acronyms.js";
  import Acronym from "$lib/components/Acronym.svelte";

  const contributions = sourceContributions(valleyfieldDossiers);

  const phaseLabels: Record<string, string> = {
    signal: "Signal",
    ancrage: "Ancrage",
    contraintes: "Contraintes",
    marche: "Marche",
    contexte: "Contexte",
    scoring: "Scoring",
  };

  function phaseBadgeClass(phase: string): string {
    switch (phase) {
      case "signal":
        return "bg-teal-100 text-teal-800";
      case "ancrage":
        return "bg-blue-100 text-blue-800";
      case "contraintes":
        return "bg-red-100 text-red-700";
      case "marche":
        return "bg-amber-100 text-amber-800";
      case "contexte":
        return "bg-slate-100 text-slate-700";
      case "scoring":
        return "bg-violet-100 text-violet-800";
      default:
        return "bg-slate-100 text-slate-600";
    }
  }

  /** Derive un libelle court a partir du label complet de l'evidence */
  function shortLabel(label: string): string {
    // Tronquer apres 60 caracteres pour l'affichage compact
    return label.length > 60 ? label.slice(0, 58) + "…" : label;
  }
</script>

<div class="space-y-6">
  <!-- En-tete explicatif -->
  <div class="rounded-lg border border-teal-100 bg-teal-50 p-4">
    <div class="flex items-center gap-2">
      <BarChart2 class="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
      <h1 class="text-sm font-semibold text-teal-900">
        Contribution de chaque source au faisceau de preuves
      </h1>
    </div>
    <p class="mt-1.5 max-w-prose text-xs text-teal-800 leading-5" style="max-width: 70ch;">
      Ce tableau montre, pour chaque source de donnees, combien de dossiers elle
      alimente, le nombre total de preuves produites, les phases couvertes (signal,
      ancrage, contraintes, marche, contexte, scoring) et le mix de verification
      (fait confirme / hypothese / non-disponible). Les sources en tete sont
      celles qui contribuent le plus au faisceau de preuves collectif.
    </p>
  </div>

  <!-- Table de contribution -->
  <div class="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th class="px-4 py-2.5">Source</th>
            <th class="px-3 py-2.5 text-center">Dossiers</th>
            <th class="px-3 py-2.5 text-center">Preuves</th>
            <th class="px-3 py-2.5">Phases couvertes</th>
            <th class="px-3 py-2.5">Mix de verification</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each contributions as c}
            <tr class="hover:bg-slate-50">
              <td class="px-4 py-3 max-w-xs">
                <p class="font-medium text-slate-950 leading-tight">
                  {#if getAcronym(c.sourceId)}
                    <Acronym term={c.sourceId} />
                  {:else}
                    {shortLabel(c.label)}
                  {/if}
                </p>
                <p class="mt-0.5 text-[11px] text-slate-400 font-mono leading-tight">
                  {c.sourceId}
                </p>
              </td>
              <td class="px-3 py-3 text-center">
                <span class="inline-flex items-center justify-center rounded-full w-7 h-7 text-xs font-bold {c.dossierCount === 3 ? 'bg-teal-100 text-teal-800' : c.dossierCount === 2 ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}">
                  {c.dossierCount}
                </span>
              </td>
              <td class="px-3 py-3 text-center">
                <span class="inline-flex items-center justify-center rounded-full w-7 h-7 text-xs font-bold {c.evidenceCount >= 3 ? 'bg-teal-600 text-white' : c.evidenceCount === 2 ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'}">
                  {c.evidenceCount}
                </span>
              </td>
              <td class="px-3 py-3">
                <div class="flex flex-wrap gap-1">
                  {#each c.phases as phase}
                    <span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold {phaseBadgeClass(phase)}">
                      {phaseLabels[phase] ?? phase}
                    </span>
                  {/each}
                </div>
              </td>
              <td class="px-3 py-3">
                <div class="flex flex-wrap gap-1">
                  {#if c.verificationMix.fait > 0}
                    <span class="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
                      Fait <span class="font-bold">{c.verificationMix.fait}</span>
                    </span>
                  {/if}
                  {#if c.verificationMix.hypothese > 0}
                    <span class="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Hyp. <span class="font-bold">{c.verificationMix.hypothese}</span>
                    </span>
                  {/if}
                  {#if c.verificationMix["non-disponible"] > 0}
                    <span class="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      N/D <span class="font-bold">{c.verificationMix["non-disponible"]}</span>
                    </span>
                  {/if}
                  {#if c.verificationMix["simule"] > 0}
                    <span class="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                      Sim. <span class="font-bold">{c.verificationMix["simule"]}</span>
                    </span>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="border-t border-slate-100 px-4 py-2.5 bg-slate-50 text-xs text-slate-500">
      {contributions.length} sources recensees sur {valleyfieldDossiers.length} dossiers pilotes
    </div>
  </div>
</div>
