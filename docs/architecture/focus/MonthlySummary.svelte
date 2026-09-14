<script>
  const reportPrefix = location.pathname.includes('/reports/architecture-monthly/') ? '../' : '../reports/';
  const transitions = [
    { key: 'A', status: 'livré', detail: 'MinIO et ses PVC retirés en préproduction et production; API, graphe et scrape sur OVH S3. TEM conservé.', tone: 'warning' },
    { key: 'B', status: 'préprod acceptée', detail: 'CronJob autonome accepté en préproduction. Production dormante jusqu’à promotion de la PR #682.', tone: 'warning' },
    { key: 'NŒUDS', status: 'livré', detail: 'Migration terminée sur un seul r2-15; relevé à 70 % CPU et 53 % mémoire.', tone: 'warning' },
  ];
</script>

<section class="monthly-summary" aria-labelledby="monthly-summary-title">
  <div class="flex-row">
    <div><span class="eyebrow">Bilan mensuel · données actualisées</span><h2 id="monthly-summary-title">Résumé du rapport mensuel</h2></div>
    <span class="badge">10 août → 13 septembre 2026 inclus</span>
  </div>
  <div class="summary-grid">
    <article><p class="label">Période</p><strong>35 jours · 840 h</strong><p>America/Toronto, sans trou après le rapport terminé le 9 août.</p></article>
    <article><p class="label">Hébergement</p><strong>1 × r2-15</strong><p>Migration terminée; préproduction et production consolidées.</p></article>
    <article><p class="label">Stockage objet</p><strong>Sans MinIO</strong><p>Préproduction et production utilisent OVH S3.</p></article>
    <article><p class="label">Pipeline préprod</p><strong>Accepté</strong><p>CronJob autonome, Graphify bibliothèque, llm-mesh in-process.</p></article>
    <article><p class="label">Pipeline prod</p><strong>DORMANT</strong><p>Aucune promotion avant la PR #682.</p></article>
  </div>
  <h3>État des transitions</h3>
  <div class="transition-grid">
    {#each transitions as transition}<article data-transition={transition.key}><span class="badge">{transition.key} · {transition.status}</span><p>{transition.detail}</p></article>{/each}
  </div>
  <div class="flex-row">
    <a class="report-link" href={`${reportPrefix}rapport-mois-2026-08-10_2026-09-13.html`} download>Rapport d’activité HTML</a>
    <a class="report-link" href={`${reportPrefix}rapport-mois-2026-08-10_2026-09-13.pdf`} download>Rapport d’activité PDF</a>
    <a class="report-link" href={`${reportPrefix}couts-2026-08-10_2026-09-13.pdf`} download>Rapport de coûts séparé</a>
    <a class="report-link" href={`${reportPrefix}rapport-mois-2026-07-13_2026-08-09.pdf`} download>Rapport d’activité précédent</a>
  </div>
  <p class="availability">Liens locaux : disponibles lorsque les artefacts mensuels sont présents à côté du dossier.</p>
  <p class="availability">Les montants et allocations ne figurent pas dans ce bilan d’activité; ils sont réservés au rapport de coûts séparé.</p>
</section>

<style>
  .monthly-summary { margin: 36px 0; padding: 28px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-subtle); }
  .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 20px 0 28px; }
  .summary-grid p, .transition-grid p, .availability { font-size: .84rem; line-height: 1.5; }
  .summary-grid strong { display: block; font-size: 1.25rem; margin: 6px 0; } .label { margin: 0; font-weight: 700; }
  .transition-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 16px 0 22px; }
  .transition-grid article { padding: 16px; background: var(--st-semantic-surface-default); border: 1px solid var(--st-semantic-border-subtle); }
  .report-link { padding: 10px 14px; color: var(--st-semantic-action-primary); background: var(--st-semantic-surface-default); border: 1px solid var(--st-semantic-border-strong); text-decoration: none; }
  @media (max-width: 900px) { .summary-grid, .transition-grid { grid-template-columns: 1fr; } .monthly-summary { padding: 20px 16px; } }
</style>
