<script>
  const reportPrefix = location.pathname.includes('/reports/architecture-monthly/') ? './' : '../reports/architecture-monthly/';
  const transitions = [
    { key: 'A', status: 'cutover observé partiel', detail: 'OVH S3 et absence MinIO observés; GHCR intégré. Parité finale/balayage ouverts; TEM conservé.', tone: 'warning' },
    { key: 'B', status: 'préprod acceptée', detail: 'CronJob autonome accepté en préproduction. Production dormante jusqu’à promotion; modèle en attente M1.', tone: 'warning' },
    { key: 'M1', status: 'à ratifier', detail: 'Sonnet comparable, Luna low, Gemini 3.8 lowest. Aucun gagnant; no-output Gemini non classable.', tone: 'warning' },
  ];
</script>

<section class="monthly-summary" aria-labelledby="monthly-summary-title">
  <div class="flex-row">
    <div><span class="eyebrow">Après le dossier · données actualisées</span><h2 id="monthly-summary-title">Résumé du rapport mensuel</h2></div>
    <span class="badge">10 août → 13 septembre 2026 inclus</span>
  </div>
  <div class="summary-grid">
    <article><p class="label">Période</p><strong>35 jours · 840 h</strong><p>America/Toronto, sans trou après le rapport terminé le 9 août.</p></article>
    <article><p class="label">Infrastructure</p><strong>68,88 CAD</strong><p>Projection de référence : un b3-8 à 0,082 CAD/h; pas un état runtime.</p></article>
    <article><p class="label">Allocation LLM</p><strong>251,215438 CAD</strong><p>Méthode et coût provisoires; statut non critique et non final.</p></article>
    <article><p class="label">Total indicatif</p><strong>320,095438 CAD</strong><p>Infra + allocation LLM; pas une facture fournisseur.</p></article>
  </div>
  <h3>État des transitions</h3>
  <div class="transition-grid">
    {#each transitions as transition}<article data-transition={transition.key}><span class="badge">{transition.key} · {transition.status}</span><p>{transition.detail}</p></article>{/each}
  </div>
  <div class="flex-row">
    <a class="report-link" href={`${reportPrefix}report-through-2026-09-13.html`} download>Télécharger le rapport HTML</a>
    <a class="report-link" href={`${reportPrefix}report-through-2026-09-13.pdf`} download>Télécharger le rapport PDF</a>
    <a class="report-link" href="../../spec/reports/study-2026-08/report.pdf" download>Télécharger le rapport précédent joint</a>
  </div>
  <p class="availability">Liens locaux : disponibles lorsque les artefacts mensuels sont présents à côté du dossier.</p>
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
