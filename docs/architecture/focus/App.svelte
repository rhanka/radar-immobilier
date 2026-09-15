<script>
  import Pairs from './Pairs.svelte';
  import MonthlySummary from './MonthlySummary.svelte';
  import { graphs } from './.generated/data.json';
</script>

<div data-st-theme="entropic">
  <main class="dossier">
    <header class="masthead">
      <div class="flex-row">
        <span class="eyebrow">Rapport d'activité · Immo / Geo / hébergement</span>
        <span class="badge warning">2 SÉRIES · 5 SCÈNES · 13 SEPTEMBRE 2026</span>
      </div>
      <h1>Un mois de progrès,<br>de Scaleway au pipeline autonome.</h1>
      <p class="lede">L'hébergement passe de Scaleway pur à OVH préproduction et production sans MinIO. Le pipeline passe de Graphify 2.3 local à un CronJob autonome accepté en préproduction; la production demeure dormante jusqu'à promotion de la PR #682.</p>
      <div class="truth-strip"><span><strong>JUILLET · A</strong> Scaleway pur</span><span><strong>10 AOÛT · A</strong> OVH ≈ 90 % + MinIO</span><span><strong>13 SEPT. · A</strong> OVH préprod + prod sans MinIO</span><span><strong>AVANT · B</strong> Graphify 2.3 local</span><span><strong>APRÈS · B</strong> CronJob préprod; prod dormante</span></div>
    </header>
    <Pairs {graphs} />
    <MonthlySummary />
    <footer>
      <strong>Preuves embarquées · accès hors ligne</strong>
      <p>Cinq Mermaid et cinq SvelteFlow natifs, avec boîtes imbriquées et géométrie vérifiée à l'échelle 1. Les deux séries restent distinctes et la production du pipeline n'est pas présentée comme promue.</p>
    </footer>
  </main>
</div>
