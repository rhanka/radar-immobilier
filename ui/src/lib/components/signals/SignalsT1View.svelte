<script lang="ts">
  import { HelpCircle } from "@lucide/svelte";
  import { Alert, Button, Select } from "@sentropic/design-system-svelte";
  import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
  import { filterByStatus, sortSignals, markApprofondir } from "$lib/signals/feed.js";
  import type { SortKey, SortDir } from "$lib/signals/feed.js";
  import type { SignalT, SignalStatusT } from "@radar/domain";
  import { appMode } from "$lib/state/mode.js";
  import SignalRow from "./SignalRow.svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";

  // ── Props ────────────────────────────────────────────────────────────────────
  export let onApprofondir: (s: SignalT) => void = () => {};

  // ── Copie locale mutable des signaux (en-mémoire ; persistance hors-périmètre ÉV3) ──
  let signals: SignalT[] = demoSignalsT1.map((s) => ({ ...s }));

  // ── Contrôles ────────────────────────────────────────────────────────────────
  let sortMode: "score" | "vision" = "score";
  let sortDir: SortDir = "desc";
  let statusFilter: SignalStatusT | "tous" = "tous";

  // ── Bulle d'aide VISION (S1.4) ───────────────────────────────────────────────
  let helpOpen = false;
  function toggleHelp() { helpOpen = !helpOpen; }
  function closeHelp() { helpOpen = false; }

  // ── Clé de tri dérivée du mode ───────────────────────────────────────────────
  $: sortKey = (sortMode === "vision" ? "vision-priority" : "value") as SortKey;

  // ── Filtre + tri ──────────────────────────────────────────────────────────────
  $: statusFiltered = filterByStatus(signals, statusFilter);
  $: visible = sortSignals(statusFiltered, sortKey, sortDir);

  // ── Action Approfondir ────────────────────────────────────────────────────────
  let lastApprofondie: string | null = null;

  function handleApprofondir(signal: SignalT) {
    signals = markApprofondir(signals, signal.id);
    lastApprofondie = signal.id;
    onApprofondir({ ...signal, status: "à-approfondir" });
  }

  const STATUS_OPTIONS: Array<{ value: SignalStatusT | "tous"; label: string }> = [
    { value: "tous", label: "Tous" },
    { value: "nouveau", label: "Nouveau" },
    { value: "à-approfondir", label: "À approfondir" },
    { value: "surveillance", label: "Surveillance" },
    { value: "écarté", label: "Écarté" },
  ];

  // Mode global
  $: mode = $appMode;

  // Compteurs
  $: countReal = signals.filter((s) => s.mode === "real").length;
  $: countSim = signals.filter((s) => s.mode === "simulation").length;
  $: countPool = mode === "real" ? countReal : signals.length;
</script>

<ViewLayout>
  <!-- Bande latérale gauche : contrôles tri + filtre -->
  <svelte:fragment slot="controls">
    <div class="p-4 space-y-5">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tri</p>
        <div class="space-y-1.5">
          <Button
            variant={sortMode === "score" ? "primary" : "secondary"}
            size="sm"
            type="button"
            title="Trier par valeur /10 (score de type calibré)"
            onclick={() => { sortMode = "score"; sortDir = "desc"; }}
          >
            Par score /10
          </Button>

          <div class="relative flex items-center gap-1">
            <Button
              variant={sortMode === "vision" ? "primary" : "secondary"}
              size="sm"
              type="button"
              title="Trier par priorité VISION (Priorité 1 à 4)"
              onclick={() => { sortMode = "vision"; sortDir = "desc"; }}
            >
              Par priorité VISION
            </Button>
            <button
              type="button"
              class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-yellow-400 bg-yellow-50 text-yellow-700 transition hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              on:click={toggleHelp}
              aria-label="Explication des deux tris"
              title="Pourquoi deux tris ?"
            >
              <HelpCircle class="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            {#if helpOpen}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-yellow-300 bg-yellow-50 p-4 shadow-lg"
                role="tooltip"
              >
                <button
                  type="button"
                  class="absolute right-2 top-2 text-yellow-500 hover:text-yellow-700 focus:outline-none"
                  on:click={closeHelp}
                  aria-label="Fermer"
                >x</button>
                <p class="pr-4 text-sm font-semibold text-yellow-900">Pourquoi deux tris ?</p>
                <p class="mt-1 text-sm leading-5 text-yellow-800">
                  La VISION numérote Priorité&nbsp;1 à 4, mais les notes /10 ne suivent pas cet ordre :
                  CPTAQ est «&nbsp;Priorité&nbsp;4&nbsp;» dans la VISION mais vaut
                  <strong>8/10</strong>, supérieur à PPCMOI «&nbsp;Priorité&nbsp;2&nbsp;» à <strong>7/10</strong>.
                </p>
                <p class="mt-2 text-sm leading-5 text-yellow-800">
                  Par score /10&nbsp;: importance métier calibrée.<br />
                  Par priorité VISION&nbsp;: ordre Priorité&nbsp;1 (rezonage)
                  à 2 (PPCMOI) à 3 (plan d'urb.) à 4 (CPTAQ / grille).
                </p>
              </div>
              <div class="fixed inset-0 z-10" role="presentation" on:click={closeHelp}></div>
            {/if}
          </div>
        </div>
      </div>

      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filtre</p>
        <Select
          id="signals-status-filter"
          label="Filtrer par statut"
          bind:value={statusFilter}
        >
          {#each STATUS_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </Select>
      </div>

      <div class="pt-2 border-t border-slate-100">
        <p class="text-xs text-slate-400">
          {visible.length} / {signals.length} signal{signals.length !== 1 ? "s" : ""}
        </p>
        <p class="text-xs text-slate-300 mt-0.5">
          ({countReal} réels + {countSim} exemples)
        </p>
      </div>
    </div>
  </svelte:fragment>

  <!-- Zone de contenu principale -->
  <section class="min-h-full bg-slate-50 p-6">
    <!-- En-tête -->
    <header class="mb-4">
      <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
        Signaux de triage
      </p>
      <h1 class="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
        Fil de signaux
      </h1>
      <p class="mt-2 max-w-prose rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
        <span class="font-semibold text-slate-800">Score de signal = valeur /10</span>
        (priorité par type, VISION §6)
        <span class="mx-1 text-slate-400">+</span>
        <span class="font-semibold text-slate-800">confiance</span>
        (Haute / Moyenne / Faible), distinct du
        <span class="font-semibold text-slate-800">score d'opportunité (/100)</span>.
        Ces deux axes ne sont jamais multipliés.
      </p>
    </header>

    <!-- Bandeau mode réel / simulation -->
    {#if mode === "real"}
      <div class="mb-4">
        <Alert
          tone="success"
          title="Mode réel : {countReal} signal{countReal !== 1 ? 's' : ''} confirmé{countReal !== 1 ? 's' : ''}."
          message="Basculez en simulation pour voir les exemples de calibration."
        />
      </div>
    {:else}
      <div class="mb-4">
        <Alert
          tone="info"
          title="Mode simulation : {countPool} signal{countPool !== 1 ? 's' : ''} ({countReal} réel{countReal !== 1 ? 's' : ''} + {countSim} exemple{countSim !== 1 ? 's' : ''} synthétique{countSim !== 1 ? 's' : ''} badgé{countSim !== 1 ? 's' : ''})."
        />
      </div>
    {/if}

    <!-- Liste -->
    {#if visible.length === 0}
      <div class="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
        Aucun signal pour ce filtre.
      </div>
    {:else}
      <div class="space-y-2">
        {#each visible as signal (signal.id)}
          <SignalRow {signal} onApprofondir={handleApprofondir} />
        {/each}
      </div>
    {/if}

    <!-- Note action Approfondir -->
    {#if lastApprofondie}
      <div class="mt-4">
        <Alert
          tone="info"
          title="Action Approfondir enregistrée en mémoire locale uniquement (la persistance est hors-périmètre ÉV3)."
        />
      </div>
    {/if}

    <!-- Note de provenance -->
    <div class="mt-6">
      <Alert
        tone="warning"
        title="Provenance des signaux"
        message="{countReal} signal{countReal !== 1 ? 's' : ''} réel{countReal !== 1 ? 's' : ''} (avis de consultation publique vérifiés, règlements 150-49, 150-49-1, 150-51) et {countSim} exemple{countSim !== 1 ? 's' : ''} (marqués Exemple (simulation)). Les exemples illustrent des types de signaux non encore détectés dans les données réelles et restent visibles dans tous les modes."
      />
    </div>
  </section>
</ViewLayout>
