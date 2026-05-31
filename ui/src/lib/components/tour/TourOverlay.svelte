<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { TourStep } from "$lib/tour/tour-steps.js";

  // ── Props ──────────────────────────────────────────────────────────────────
  /** Liste complete des etapes. */
  export let steps: TourStep[];
  /** L'overlay est-il visible ? */
  export let active: boolean;
  /** Index de l'etape courante (controle par le parent). */
  export let currentIndex: number;
  /** Appele quand l'utilisateur clique Suivant (ou Terminer a la derniere etape). */
  export let onNext: () => void;
  /** Appele quand l'utilisateur clique Precedent. */
  export let onPrev: () => void;
  /** Appele quand l'utilisateur clique Passer / Fermer / Esc. */
  export let onClose: () => void;

  // ── Derives ──────────────────────────────────────────────────────────────
  $: currentStep = steps[currentIndex] ?? steps[0];
  $: isFirst = currentIndex === 0;
  $: isLast = currentIndex === steps.length - 1;
  $: stepLabel = `${currentIndex + 1} / ${steps.length}`;

  // ── Clavier ──────────────────────────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent): void {
    if (!active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (!isFirst) onPrev();
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener("keydown", handleKeydown);
  });
</script>

{#if active && currentStep}
  <!-- Fond semi-transparent : clic ferme la visite -->
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    role="presentation"
    class="pointer-events-auto fixed inset-0 z-[9000] bg-black/40"
    on:click={onClose}
  ></div>

  <!-- Bulle jaune centree (z au-dessus du fond) -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Visite guidee"
    tabindex="-1"
    class="fixed left-1/2 top-1/2 z-[9001] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-2xl"
  >
    <!-- Compteur d'etapes -->
    <p class="mb-3 text-[11px] font-semibold uppercase tracking-widest text-amber-600">
      {stepLabel}
    </p>

    <!-- Titre -->
    <p class="text-base font-bold text-slate-900">{currentStep.title}</p>

    <!-- Corps -->
    <p class="mt-2 text-sm leading-6 text-slate-700">{currentStep.body}</p>

    <!-- Navigation -->
    <div class="mt-5 flex items-center justify-between gap-2">
      <!-- Precedent -->
      <button
        type="button"
        class="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-amber-400"
        disabled={isFirst}
        on:click={onPrev}
        aria-label="Etape precedente"
      >
        Precedent
      </button>

      <div class="flex items-center gap-2">
        <!-- Passer -->
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          on:click={onClose}
          aria-label="Passer la visite guidee"
        >
          Passer
        </button>

        <!-- Suivant / Terminer -->
        <button
          type="button"
          class="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1"
          on:click={onNext}
          aria-label={isLast ? "Terminer la visite guidee" : "Etape suivante"}
        >
          {isLast ? "Terminer" : "Suivant"}
        </button>
      </div>
    </div>
  </div>
{/if}
