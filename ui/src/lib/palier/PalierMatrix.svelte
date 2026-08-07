<script lang="ts">
  /**
   * PalierMatrix — SCAFFOLD de la vue Matrice (villes × KPI), style tri-state
   * (réutilise l'esprit de SourceConsole). Rend : cartes sommaires + toggle
   * subset A/B + barres de résolution par-KPI + grille cellule statut + %
   * par-ville. Données = placeholder honnête « proxy immo geo-lot pending »
   * (fallback recette) jusqu'à l'artefact recette intégré (jointure geo).
   *
   * Copy produit NEUTRE (Complet/Partiel/À qualifier/N-A). Thème light+dark via
   * tokens DS. Ni api/ ni packages/.
   */
  import {
    cityResolvedPct,
    kpiResolvedPct,
    palierCellStatusLabel,
    proxyImmoPlaceholderMatrix,
    type PalierCellStatus,
    type PalierMatrix,
    type PalierSubset,
  } from "./palier-matrix-client.js";

  /**
   * Fournisseur de matrice par subset. Défaut = placeholder proxy-immo (les
   * deux subsets rendent le fallback étiqueté tant que l'artefact recette n'est
   * pas bindé). L'app injectera le vrai fournisseur dès la jointure geo.
   */
  export let matrixProvider: (subset: PalierSubset) => PalierMatrix =
    proxyImmoPlaceholderMatrix;

  let subset: PalierSubset = "B";
  $: matrix = matrixProvider(subset);

  const SUBSET_LABEL: Record<PalierSubset, string> = {
    A: "Palier 30",
    B: "167 villes",
  };

  /** Couleur de fond de cellule par statut (tokens DS + repli neutre). */
  const CELL_BG: Record<PalierCellStatus, string> = {
    complete: "var(--st-semantic-success-surface, #dcfce7)",
    incomplete: "var(--st-semantic-warning-surface, #fef3c7)",
    unknown: "var(--st-semantic-surface-subtle, #f1f5f9)",
    na: "var(--st-semantic-surface, #ffffff)",
  };
  const CELL_FG: Record<PalierCellStatus, string> = {
    complete: "var(--st-semantic-success-text, #166534)",
    incomplete: "var(--st-semantic-warning-text, #92400e)",
    unknown: "var(--st-semantic-text-muted, #64748b)",
    na: "var(--st-semantic-text-muted, #94a3b8)",
  };

  function setSubset(next: PalierSubset): void {
    subset = next;
  }
</script>

<section class="palier" data-testid="palier-matrix" aria-label="Matrice villes × KPI">
  <!-- Cartes sommaires -->
  <div class="palier-summary" data-testid="palier-summary">
    <div class="palier-card">
      <span class="palier-card-key">Villes</span>
      <span class="palier-card-val">{matrix.cities.length}</span>
    </div>
    <div class="palier-card">
      <span class="palier-card-key">KPI</span>
      <span class="palier-card-val">{matrix.kpis.length}</span>
    </div>
    <div class="palier-card palier-card--label" data-testid="palier-label">
      <span class="palier-card-key">Source</span>
      <span class="palier-card-val palier-card-val--muted">{matrix.label}</span>
    </div>
  </div>

  <!-- Toggle subset A / B -->
  <div class="palier-toggle" role="group" aria-label="Sous-ensemble" data-testid="palier-subset-toggle">
    {#each ["A", "B"] as s (s)}
      <button
        type="button"
        class="palier-toggle-btn"
        class:palier-toggle-btn--active={subset === s}
        aria-pressed={subset === s}
        data-testid={`palier-subset-${s}`}
        on:click={() => setSubset(s)}
      >
        {SUBSET_LABEL[s]}
      </button>
    {/each}
  </div>

  <!-- Barres de résolution par KPI -->
  <div class="palier-bars" data-testid="palier-kpi-bars">
    {#each matrix.kpis as kpi (kpi.id)}
      {@const pct = kpiResolvedPct(matrix, kpi.id)}
      <div class="palier-bar-row">
        <span class="palier-bar-label">{kpi.label}</span>
        <div class="palier-bar-track">
          <div class="palier-bar-fill" style="width: {pct}%"></div>
        </div>
        <span class="palier-bar-pct">{pct} %</span>
      </div>
    {/each}
  </div>

  <!-- Grille ville × KPI -->
  <div class="palier-grid-wrap">
    <table class="palier-grid" data-testid="palier-grid">
      <thead>
        <tr>
          <th scope="col" class="palier-th-city">Ville</th>
          {#each matrix.kpis as kpi (kpi.id)}
            <th scope="col" class="palier-th-kpi" title={kpi.label}>{kpi.label}</th>
          {/each}
          <th scope="col" class="palier-th-pct">Résolu</th>
        </tr>
      </thead>
      <tbody>
        {#each matrix.cities as row (row.citySlug)}
          <tr data-testid={`palier-row-${row.citySlug}`}>
            <th scope="row" class="palier-td-city">{row.cityName}</th>
            {#each row.cells as cell (cell.kpiId)}
              <td
                class="palier-cell"
                data-status={cell.status}
                title={palierCellStatusLabel(cell.status)}
                style="background: {CELL_BG[cell.status]}; color: {CELL_FG[cell.status]};"
              >
                {palierCellStatusLabel(cell.status)}
              </td>
            {/each}
            <td class="palier-td-pct">{cityResolvedPct(row)} %</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .palier {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    color: var(--st-semantic-text-primary, #1e293b);
  }
  .palier-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .palier-card {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: 0.5rem;
    background: var(--st-semantic-surface, #ffffff);
    min-width: 5rem;
  }
  .palier-card-key {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--st-semantic-text-muted, #94a3b8);
  }
  .palier-card-val {
    font-size: 1.1rem;
    font-weight: 600;
  }
  .palier-card-val--muted {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--st-semantic-text-secondary, #475569);
  }
  .palier-toggle {
    display: inline-flex;
    gap: 0.25rem;
  }
  .palier-toggle-btn {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: 0.4rem;
    background: var(--st-semantic-surface, #ffffff);
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .palier-toggle-btn--active {
    background: var(--st-semantic-accent-surface, #0f766e);
    color: #ffffff;
    border-color: var(--st-semantic-accent-surface, #0f766e);
  }
  .palier-bars {
    display: grid;
    gap: 0.25rem;
  }
  .palier-bar-row {
    display: grid;
    grid-template-columns: 6rem 1fr 3rem;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
  }
  .palier-bar-label {
    color: var(--st-semantic-text-secondary, #475569);
  }
  .palier-bar-track {
    height: 0.5rem;
    border-radius: 0.25rem;
    background: var(--st-semantic-surface-subtle, #f1f5f9);
    overflow: hidden;
  }
  .palier-bar-fill {
    height: 100%;
    background: var(--st-semantic-success-surface, #16a34a);
  }
  .palier-bar-pct {
    text-align: right;
    color: var(--st-semantic-text-muted, #64748b);
  }
  .palier-grid-wrap {
    overflow-x: auto;
  }
  .palier-grid {
    border-collapse: collapse;
    font-size: 0.75rem;
    width: 100%;
  }
  .palier-grid th,
  .palier-grid td {
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding: 0.3rem 0.45rem;
    text-align: center;
    white-space: nowrap;
  }
  .palier-th-city,
  .palier-td-city {
    text-align: left;
    position: sticky;
    left: 0;
    background: var(--st-semantic-surface, #ffffff);
    font-weight: 600;
  }
  .palier-td-pct,
  .palier-th-pct {
    font-weight: 600;
  }
  .palier-cell {
    font-weight: 500;
  }
</style>
