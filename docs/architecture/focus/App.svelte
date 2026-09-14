<script>
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import Pairs from './Pairs.svelte';
  import { presentation } from './presentation-fr.js';
  import Choices from './Choices.svelte';
  import MonthlySummary from './MonthlySummary.svelte';
  import mermaid from './.generated/mermaid.json';
  import data from './.generated/data.json';
  const titles = ['Architecture AVANT', 'Architecture APRÈS', 'Delta factuel', 'Gates & retour arrière', 'Décisions ratifiées', 'Questions ouvertes', 'Preuves & limites', 'Annexe facturation'];
  let step = $state(0), note = $state(''), saved = $state(false), storageError = $state(false), source = $state(null);
  const key = `immo-focus-decision:${data.manifest.artifactInputHash}:draft`;
  const renderer = new marked.Renderer();
  renderer.html = () => '';
  const code = renderer.code.bind(renderer);
  renderer.code = token => {
    const graph = token.lang === 'mermaid' && data.graphs.find(g => g.source.trim() === token.text.trim());
    return graph ? `<figure class="source-mermaid">${mermaid[graph.id].svg.replaceAll(`mermaid-${graph.id}`, `source-mermaid-${graph.id}`)}</figure>` : code(token);
  };
  const html = text => DOMPurify.sanitize(marked.parse(text, { renderer }), { FORBID_TAGS: ['script', 'iframe', 'form', 'foreignObject'] });
  onMount(() => { try { note = localStorage.getItem(key) ?? ''; } catch { storageError = true; } });
  function save(value) { note = value; try { localStorage.setItem(key, value); saved = true; } catch { storageError = true; } }
  function download() {
    const blob = new Blob([JSON.stringify({ schema: 'immo-focus-owner-notes/v1', status: 'draft-not-ratified', dossierHash: data.manifest.dossierHash, artifactInputHash: data.manifest.artifactInputHash, notes: note }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'immo-decision-notes.json'; a.click(); URL.revokeObjectURL(a.href);
  }
  function link(event) {
    const a = event.target.closest('a'); if (!a) return;
    const name = a.getAttribute('href')?.split('/').at(-1)?.replace(/\.md(?:#.*)?$/, '');
    if (data.docs[name]) { event.preventDefault(); source = name; }
    else if (/^https:\/\//.test(a.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  }
  function modal(node) { node.showModal(); return { destroy() { node.close(); } }; }
</script>

<div data-st-theme="entropic">
    <main class="dossier">
      <header class="masthead">
        <div class="flex-row">
        <span class="eyebrow">Focus · rapport architecture · Immo / Geo / Kubernetes</span>
          <span class="badge warning">2 PAIRES · 4 SCÈNES · 13 SEPTEMBRE 2026</span>
        </div>
        <h1>Deux transitions datées,<br>quatre vues vérifiables.</h1>
        <p class="lede">La production passe de MinIO/SCW à OVH S3/GHCR, avec TEM explicitement conservé. Le refresh passe du poste manuel au CronJob autonome intégré; la production demeure dormante et le modèle reste à ratifier.</p>
        <div class="truth-strip"><span><strong>9 AOÛT · A</strong> MinIO + restes SCW/registre</span><span><strong>13 SEPT. · A</strong> OVH S3 + GHCR; TEM résiduel</span><span><strong>9 AOÛT · B</strong> refresh manuel depuis le poste</span><span><strong>13 SEPT. · B</strong> CronJob; PROD dormante; modèle en attente</span></div>
      </header>
      <Pairs graphs={data.graphs} />
      <nav class="steps" aria-label="Sections du dossier">
        {#each titles as title, index}<button class:active={step === index} aria-current={step === index ? 'step' : undefined} onclick={() => step = index}><span>{index + 1}</span>{title}</button>{/each}
      </nav>
      <progress value={step + 1} max="8" aria-label={`Section ${step + 1} sur 8`}></progress>
      <section class="decision-content">
        <div class="section-heading"><span class="eyebrow">{step + 1} / 8 · dossier D9 · 13 septembre 2026</span><h2>{titles[step]}</h2></div>
        <!-- The French reading surface links to the complete repository dossier. -->
        {#if step === 5}<Choices manifest={data.manifest} remarks={note} />{:else}<div class="prose" onclick={link} role="presentation">{@html html(presentation[step])}</div>{/if}
        <button onclick={() => source = 'decision-dossier'}>Dossier source complet · références et qualification des faits</button>
        {#if step === 6}<button onclick={() => source = 'decision-reviews'}>Lire les avis réels des reviewers</button>{/if}
      </section>
      <MonthlySummary />
      <section class="notes"><h2>Vos remarques · brouillon local</h2>
        <p>Cette page ne signe rien, ne crée aucune décision Track et ne lance aucun traitement. Les notes restent dans ce navigateur.</p>
        <label>Remarques sur les décisions et critères manquants<textarea value={note} oninput={event => save(event.currentTarget.value)} rows="4"></textarea></label>
        <div class="flex-row"><button onclick={download}>Exporter mes remarques</button><span role="status">{storageError ? 'Stockage local indisponible : exporter avant de fermer.' : saved ? 'Brouillon enregistré localement — non ratifié' : 'Aucune approbation enregistrée'}</span></div>
      </section>
      <footer><strong>Preuves embarquées · accès hors ligne</strong><div class="source-links">{#each ['architecture', 'transitions-target', 'transitions', 'storage-audit', 'service-provenance', 'continuation-audit', 'decision-dossier', 'decision-reviews', 'proposal'] as name}<button onclick={() => source = name}>{name}</button>{/each}</div>
        <p>Composants Focus, SvelteFlow natif intégral et boîtes parentId imbriquées. Tous les liens sont conservés ; absence de croisements d’arêtes non certifiée.</p>
      </footer>
    </main>
    {#if source}<dialog class="source-overlay" use:modal onclose={() => source = null} aria-label={`Source ${source}`}><section class="source-sheet"><button onclick={() => source = null}>Fermer la source</button><div class="prose" onclick={link} role="presentation">{@html html(data.docs[source])}</div></section></dialog>{/if}
</div>
