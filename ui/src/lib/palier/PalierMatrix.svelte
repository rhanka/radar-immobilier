<script lang="ts">
  /**
   * PalierMatrix — vue Matrice (villes × 20 KPI). Le SCOPE B, le DÉNOMINATEUR
   * et la RÉCENCE sont calculés LIVE côté client (fetch by-city date-aware,
   * lock conducteur « matrix-clientside-live ») : dans le navigateur SSO de
   * l'owner, ça rend SON 127/36. Les cellules immo (kpi04/kpi20) + priorité =
   * réf. hors-ligne ; les 17 geo restent « À qualifier » jusqu'au mapping.
   *
   * Copy produit NEUTRE (Complet/Partiel/À qualifier/N-A). Thème light+dark via
   * tokens DS. Ni api/ ni packages/.
   */
  import { onMount } from "svelte";
  import {
    buildPalierMatrixLive,
    cityResolvedPct,
    kpiResolvedPct,
    palierCellStatusLabel,
    type PalierCellStatus,
    type PalierCityRow,
    type PalierMatrix,
    type RecencyFilter,
  } from "./palier-matrix-client.js";

  /** Injectable (tests/preview) ; défaut = build LIVE (fetch by-city authentifié). */
  export let matrixLoader: () => Promise<PalierMatrix> = () =>
    buildPalierMatrixLive();

  let matrix: PalierMatrix | null = null;
  let loading = true;
  let error: string | null = null;
  let recencyFilter: RecencyFilter = "all";

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      matrix = await matrixLoader();
    } catch (e) {
      error = e instanceof Error ? e.message : "Chargement impossible";
      matrix = null;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const REC_FILTERS: { id: RecencyFilter; label: string }[] = [
    { id: "all", label: "Toutes" },
    { id: "lt3mo", label: "< 3 mois" },
    { id: "lt6mo", label: "< 6 mois" },
  ];

  function inRecency(row: PalierCityRow, f: RecencyFilter): boolean {
    if (f === "all") return true;
    if (f === "lt3mo") return row.recency === "lt3mo";
    return row.recency === "lt3mo" || row.recency === "lt6mo";
  }

  const REC_LABEL: Record<string, string> = {
    lt3mo: "< 3 mois",
    lt6mo: "< 6 mois",
    older: "> 6 mois",
  };

  $: visibleRows = matrix
    ? matrix.cities.filter((r) => inRecency(r, recencyFilter))
    : [];
  $: denominator = matrix?.denominator ?? matrix?.cities.length ?? 0;

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
</script>

<section class="palier" data-testid="palier-matrix" aria-label="Matrice villes × KPI">
  {#if loading}
    <p class="palier-state" data-testid="palier-loading">Chargement de la couverture live…</p>
  {:else if error}
    <div class="palier-state palier-state--error" data-testid="palier-error">
      <p>Couverture live indisponible.</p>
      <button type="button" class="palier-retry" on:click={load}>Réessayer</button>
    </div>
  {:else if matrix}
    <!-- Cartes sommaires : dénominateur B LIVE + priorité + récence -->
    <div class="palier-summary" data-testid="palier-summary">
      <div class="palier-card">
        <span class="palier-card-key">Cohorte B (live)</span>
        <span class="palier-card-val" data-testid="palier-denominator">{denominator}</span>
      </div>
      <div class="palier-card">
        <span class="palier-card-key">Priorité</span>
        <span class="palier-card-val" data-testid="palier-priority-count">{matrix.priorityCount ?? 0}</span>
      </div>
      <div class="palier-card">
        <span class="palier-card-key">Signal &lt; 3 mois</span>
        <span class="palier-card-val" data-testid="palier-recency-lt3mo">{matrix.recencyCounts?.lt3mo ?? 0}</span>
      </div>
      <div class="palier-card">
        <span class="palier-card-key">Signal &lt; 6 mois</span>
        <span class="palier-card-val" data-testid="palier-recency-lt6mo">{matrix.recencyCounts?.lt6mo ?? 0}</span>
      </div>
      <div class="palier-card palier-card--label" data-testid="palier-label">
        <span class="palier-card-key">Source</span>
        <span class="palier-card-val palier-card-val--muted">{matrix.label}</span>
      </div>
    </div>

    <!-- Toggle récence (tri/filtre) ; le % reste sur la cohorte B -->
    <div class="palier-toggle" role="group" aria-label="Récence" data-testid="palier-recency-toggle">
      {#each REC_FILTERS as f (f.id)}
        <button
          type="button"
          class="palier-toggle-btn"
          class:palier-toggle-btn--active={recencyFilter === f.id}
          aria-pressed={recencyFilter === f.id}
          data-testid={`palier-recency-btn-${f.id}`}
          on:click={() => (recencyFilter = f.id)}
        >
          {f.label}
        </button>
      {/each}
    </div>

    <!-- Barres de résolution par KPI (sur la cohorte B complète) -->
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

    <!-- Grille ville × KPI (priorité en tête, puis récence) -->
    <div class="palier-grid-wrap">
      <table class="palier-grid" data-testid="palier-grid">
        <thead>
          <tr>
            <th scope="col" class="palier-th-city">Ville</th>
            <th scope="col" class="palier-th-rec">Récence</th>
            {#each matrix.kpis as kpi (kpi.id)}
              <th scope="col" class="palier-th-kpi" title={kpi.label}>{kpi.label}</th>
            {/each}
            <th scope="col" class="palier-th-pct">Résolu</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleRows as row (row.citySlug)}
            <tr data-testid={`palier-row-${row.citySlug}`} class:palier-row--priority={row.isPriority}>
              <th scope="row" class="palier-td-city">
                {#if row.isPriority}<span class="palier-prio-dot" title="Priorité" aria-label="Priorité">●</span>{/if}
                {row.cityName}
              </th>
              <td class="palier-td-rec">{REC_LABEL[row.recency ?? "older"]}</td>
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
  {/if}
</section>

<style>
  .palier {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    color: var(--st-semantic-text-primary, #1e293b);
  }
  .palier-state {
    padding: 1rem;
    color: var(--st-semantic-text-muted, #64748b);
    font-size: 0.85rem;
  }
  .palier-state--error {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--st-semantic-warning-text, #92400e);
  }
  .palier-retry {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    border-radius: 0.4rem;
    background: var(--st-semantic-surface, #ffffff);
    color: var(--st-semantic-text-secondary, #475569);
    cursor: pointer;
    font-size: 0.8rem;
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
  .palier-row--priority .palier-td-city {
    background: var(--st-semantic-accent-surface-subtle, #f0fdfa);
  }
  .palier-prio-dot {
    color: var(--st-semantic-accent-surface, #0f766e);
    margin-right: 0.25rem;
    font-size: 0.7rem;
  }
  .palier-td-rec {
    color: var(--st-semantic-text-secondary, #475569);
  }
  .palier-td-pct,
  .palier-th-pct {
    font-weight: 600;
  }
  .palier-cell {
    font-weight: 500;
  }
</style>
