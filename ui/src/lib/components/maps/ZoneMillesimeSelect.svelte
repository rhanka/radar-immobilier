<script lang="ts">
  /**
   * ZoneMillesimeSelect — sélecteur EXCLUSIF de millésime de zonage.
   *
   * Composant DS partagé, monté aux DEUX points d'entrée (légende Zonage de la
   * carte + en-tête de l'accordéon Zones) sur le MÊME état. Contrat produit :
   *  - MASQUÉ tant qu'il n'y a pas ≥ 2 millésimes servis pour la ville : dégradé
   *    honnête, JAMAIS un sélecteur mono-option (aujourd'hui une seule cohorte
   *    par ville, cf. note ask geo dans la PR) ;
   *  - défaut « Tous les millésimes » (`null`) : aucune zone retirée ;
   *  - ZÉRO refetch : `onChange` ne fait que remonter le millésime retenu, le
   *    parent recalcule la peinture MapLibre + la liste du pane droit.
   */
  import { Select } from "@sentropic/design-system-svelte";
  import {
    zoneMillesimeValues,
    hasMultipleZoneMillesimes,
    type ZoneMillesimeFilter,
  } from "$lib/maps/zone-millesime-filter.js";

  /** Base de calcul des millésimes = TOUTES les zones de la ville (jamais la
   *  couche déjà filtrée par millésime — sinon le sélecteur se masquerait). */
  export let zones: ReadonlyArray<{ reglementMillesime?: string | null }> = [];
  export let filter: ZoneMillesimeFilter = null;
  export let onChange: (filter: ZoneMillesimeFilter) => void = () => {};

  /** Valeur sentinelle « tous » du <select> (le filtre applicatif reste `null`). */
  const ALL = "__all__";

  $: values = zoneMillesimeValues(zones);
  $: multiMillesime = hasMultipleZoneMillesimes(zones);

  // Valeur contrôlée du <select>. Down-sync : le filtre parent pilote l'affichage.
  let selectValue: string = ALL;
  $: selectValue = filter ?? ALL;

  // Up-sync : un changement UTILISATEUR (bind:value) remonte le filtre. Garde
  // anti-écho : no-op quand la valeur reflète déjà le filtre courant (pas de
  // boucle réactive, pas d'onChange parasite au montage).
  $: {
    const next = selectValue === ALL ? null : selectValue;
    if (next !== (filter ?? null)) onChange(next);
  }
</script>

{#if multiMillesime}
  <div class="zone-millesime" data-testid="signaux-zone-millesime-select">
    <Select label="Millésime du zonage" size="sm" bind:value={selectValue}>
      <option value={ALL}>Tous les millésimes</option>
      {#each values as v (v.millesime)}
        <option value={v.millesime}
          >{v.millesime} · {v.count} zone{v.count > 1 ? "s" : ""}</option
        >
      {/each}
    </Select>
  </div>
{/if}

<style>
  .zone-millesime {
    display: grid;
    gap: 0.25rem;
  }
</style>
