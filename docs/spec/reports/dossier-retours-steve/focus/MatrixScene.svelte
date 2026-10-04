<script>
  // Criteria matrix: one row per criterion of Steve (and per transversal exclusion),
  // what he asks, what the radar does today, the coverage, and the noise it leaves in his
  // working view (pass 1). The last row adds up the noise over the 73 signals of the view.
  let { graph } = $props();
  const { rows, total } = $derived(graph.projection);
  const percent = (part, whole) => `${(part / whole * 100).toFixed(1).replace('.', ',')} %`;
  const COVERAGE = { couvert: 'Couvert', partiel: 'Partiel', absent: 'Absent' };
</script>

<div class="matrix-wrap" data-diagram={graph.id} data-diagram-kind="matrix">
  <table class="matrix" data-matrix={graph.id}>
    <caption>Critères de Steve × radar actuel (origin/main 27891b10) · bruit mesuré sur sa vue de travail, passe 1</caption>
    <thead>
      <tr><th scope="col">Critère</th><th scope="col">Steve demande</th><th scope="col">Radar aujourd’hui</th>
        <th scope="col">Couverture</th><th scope="col" class="num">Bruit passe 1</th></tr>
    </thead>
    <tbody>
      {#each rows as row}
        <tr data-row={row.criterion} data-coverage={row.coverage} data-noise={row.noise}>
          <th scope="row">{row.criterion}</th>
          <td>{row.steve}</td>
          <td>{row.radar.replaceAll('`', '')}</td>
          <td><span class="coverage coverage-{row.coverage}" data-text-role="coverage">{COVERAGE[row.coverage]}</span></td>
          <td class="num">
            <span class="noise"><span class="noise-bar" style={`width:${row.noise / total.noise * 100}%`}></span></span>
            <strong>{row.noise}</strong> <span class="share">sur {total.noise}</span>
          </td>
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr data-row="total" data-noise={total.noise}>
        <th scope="row">{total.criterion}</th>
        <td>{total.steve}</td>
        <td>{total.radar}</td>
        <td></td>
        <td class="num">
          <span class="noise"><span class="noise-bar total" style={`width:${total.noise / total.workingView * 100}%`}></span></span>
          <strong>{total.noise} sur {total.workingView}</strong> <span class="share">{percent(total.noise, total.workingView)}</span>
        </td>
      </tr>
    </tfoot>
  </table>
</div>
<p class="diagram-legend"><strong>Lecture</strong> · une ligne par critère ou exclusion · couverture : ce que le radar sait filtrer aujourd’hui ·
  barre : part du bruit de la passe 1 laissée par ce critère (ligne du bas : bruit sur les 73 signaux de la vue).</p>

<style>
  .matrix-wrap { overflow-x: auto; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  .matrix { width: 100%; border-collapse: collapse; font-size: .95rem; line-height: 1.45; }
  .matrix caption { caption-side: top; text-align: left; padding: 12px 16px; font-size: .82rem; color: var(--st-semantic-text-secondary); background: var(--st-semantic-surface-subtle); }
  .matrix th, .matrix td { padding: 14px 16px; border-bottom: 1px solid var(--st-semantic-border-subtle); text-align: left; vertical-align: top; }
  .matrix thead th { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--st-semantic-text-secondary); background: var(--st-semantic-surface-subtle); }
  .matrix tbody th { width: 17%; font-weight: 700; }
  .matrix td:nth-child(2), .matrix td:nth-child(3) { width: 27%; }
  .matrix .num { width: 17%; white-space: nowrap; }
  .matrix tfoot th, .matrix tfoot td { border-top: 2px solid var(--st-semantic-border-strong); border-bottom: 0; background: var(--st-semantic-surface-subtle); font-weight: 600; }
  .coverage { display: inline-block; padding: 4px 10px; font-size: .78rem; font-weight: 700; border: 1px solid; }
  .coverage-couvert { color: var(--dossier-ok-text); border-color: var(--dossier-ok); background: var(--dossier-ok-bg); }
  .coverage-partiel { color: var(--dossier-partial-text); border-color: var(--dossier-partial); background: var(--dossier-partial-bg); }
  .coverage-absent { color: var(--dossier-gap-text); border-color: var(--dossier-gap); background: var(--dossier-gap-bg); }
  .noise { display: block; height: 8px; margin-bottom: 6px; background: var(--st-semantic-surface-subtle); border: 1px solid var(--st-semantic-border-subtle); }
  .noise-bar { display: block; height: 100%; background: var(--st-semantic-data-category2); }
  .noise-bar.total { background: var(--st-semantic-data-category1); }
  .share { color: var(--st-semantic-text-secondary); font-size: .85rem; }
  .diagram-legend { font-size: .82rem; line-height: 1.55; color: var(--st-semantic-text-secondary); }
</style>
