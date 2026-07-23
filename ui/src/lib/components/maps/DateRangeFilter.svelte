<script lang="ts">
  /**
   * DateRangeFilter — sélecteur de plage de dates PARTAGÉ des filtres Signaux.
   *
   * Réutilisé À L'IDENTIQUE dans les deux panneaux (Référence A / Nouveau B) du
   * rail pour garantir la parité : une seule définition, un seul état porté par
   * le parent. C'est le PREMIER contrôle du pipeline d'affichage (au-dessus des
   * axes) : la plage définit la population de base que les toggles A/B affinent.
   *
   * Composition 100 % design-system (0.34.69) :
   *   - Presets 3 / 6 / 12 mois → `ButtonGroup` segmenté (attached) de `Button`.
   *     Le DS n'a pas de presets natifs : ce sont donc des boutons, l'actif en
   *     `variant="primary"` (les autres en `ghost`), avec `aria-pressed`.
   *   - Repli plage EXACTE → `DatePicker mode="range"` (bind:value). Choisir un
   *     preset recalcule la plage ; choisir une plage custom désélectionne les
   *     presets (aucun preset ne reconstruit alors la plage).
   *
   * ZÉRO couleur en dur · ZÉRO override d'interne DS · copy produit NEUTRE.
   */
  import { Button, ButtonGroup, DatePicker } from "@sentropic/design-system-svelte";
  import type { DatePickerRange } from "@sentropic/design-system-svelte";
  import {
    activePresetForRange,
    DATE_RANGE_PRESETS,
    presetRange,
    sameRange,
    type DateRangePresetMonths,
    type SignalDateRange,
  } from "$lib/signals/signal-date-filter.js";

  /** Plage courante (portée par le parent — source unique de vérité). */
  export let value: SignalDateRange;
  /** Émis à chaque changement (preset OU plage custom). */
  export let onChange: (next: SignalDateRange) => void = () => {};

  const PRESET_LABELS: Record<DateRangePresetMonths, string> = {
    3: "3 mois",
    6: "6 mois",
    12: "12 mois",
  };

  // Borne haute du calendrier : aujourd'hui (les presets sont « les N derniers
  // mois », une fin future n'aurait pas de sens). Figée à l'ouverture.
  const today = new Date();

  /** Preset actif (surligné), ou null quand la plage est custom. */
  $: activePreset = activePresetForRange(value);

  function selectPreset(months: DateRangePresetMonths): void {
    const next = presetRange(months);
    if (!sameRange(next, value)) onChange(next);
  }

  // ── Miroir local lié au DatePicker ────────────────────────────────────────
  // Le DatePicker écrit sa plage dans `picked` via un binding. On distingue les
  // deux SENS de synchronisation avec `lastValue` (dernière plage reçue du
  // parent), sinon les deux `$:` se battraient et écraseraient l'édition :
  //   - DESCENDANT (clic preset → le parent change `value`) : on rafraîchit
  //     `picked` et on NE réémet pas.
  //   - MONTANT (l'utilisateur édite le calendrier → `picked` diverge de
  //     `value`) : on remonte la plage au parent (les presets se désélectionnent
  //     alors d'eux-mêmes, plus aucun ne reconstruisant la plage).
  let lastValue: SignalDateRange = value;
  let picked: DatePickerRange = { start: value.start, end: value.end };
  $: if (!sameRange(value, lastValue)) {
    lastValue = value;
    picked = { start: value.start, end: value.end };
  }
  $: if (!sameRange(picked, value)) {
    onChange({ start: picked.start, end: picked.end });
  }
</script>

<div class="date-range-filter">
  <ButtonGroup attached size="sm" label="Plage de dates">
    {#each DATE_RANGE_PRESETS as months (months)}
      <Button
        size="sm"
        variant={activePreset === months ? "primary" : "ghost"}
        aria-pressed={activePreset === months}
        onclick={() => selectPreset(months)}
      >
        {PRESET_LABELS[months]}
      </Button>
    {/each}
  </ButtonGroup>

  <DatePicker
    mode="range"
    size="sm"
    locale="fr-CA"
    max={today}
    label="Plage exacte"
    placeholder="Plage personnalisée"
    bind:value={picked}
  />
</div>

<style>
  .date-range-filter {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    /* Pas de padding horizontal : le conteneur (.vivier-panel du rail) pose
       déjà la gouttière ; le composant reste aligné sur les toggles d'axes. */
    padding: 0;
  }

</style>
