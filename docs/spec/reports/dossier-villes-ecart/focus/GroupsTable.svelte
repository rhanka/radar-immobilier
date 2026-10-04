<script>
  // Tableau 3 — les huit groupes de villes et leurs comptes (§5.1 du dossier).
  import { groups, totals } from './groups.js';
</script>

<section class="groups" data-groups-table aria-labelledby="table-3-title">
  <span class="eyebrow">Tableau 3 · §5.1 · 226 villes en huit groupes</span>
  <h2 id="table-3-title">Les groupes de villes, chiffrés</h2>
  <p class="caption">« Identifiant partagé » : au moins une ville du groupe a un identifiant rattaché dans PG à une autre ville ; sa réparation attend la correction de la collision (D2).</p>
  <div class="table-scroll">
    <table>
      <thead><tr><th>Groupe</th><th>Villes</th><th>Ce qui diverge</th><th>Cause</th><th>Remède proposé</th><th>Identifiant partagé</th><th>Décision</th></tr></thead>
      <tbody>
        {#each groups as group}
          <tr data-group={group.id}>
            <th scope="row"><strong>{group.id}</strong><span>{group.label}</span></th>
            <td class="count">{group.cities}</td>
            <td>{group.gap}</td>
            <td>{group.cause}</td>
            <td>{group.remedy}</td>
            <td>{group.shared ? 'oui' : 'non'}</td>
            <td><strong>{group.decision}</strong></td>
          </tr>
        {/each}
      </tbody>
      <tfoot><tr><th scope="row">Total</th><td class="count">{totals.cities}</td><td colspan="5">{totals.halted} stoppées le 2026-10-03 (G1, G2, G3, G5b, G5c, G6) · {totals.aborted} avortées (G4, G5a)</td></tr></tfoot>
    </table>
  </div>
</section>

<style>
  .groups { margin: 40px 0; border-top: 4px solid var(--st-semantic-data-category1); padding-top: 16px; }
  .groups h2 { margin: 4px 0 8px; }
  .table-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; min-width: 820px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid var(--st-semantic-border-subtle); text-align: left; vertical-align: top; }
  thead th { background: var(--st-semantic-surface-subtle); }
  tbody th span { display: block; font-weight: 400; color: var(--st-semantic-text-secondary); }
  .count { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 1.05rem; }
  tfoot th, tfoot td { border-top: 3px solid var(--st-semantic-border-strong); font-weight: 650; }
</style>
