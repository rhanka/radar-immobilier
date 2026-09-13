<script>
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { AppShell, ThemeProvider, Container, Badge, Button, Flex, ProgressBar, Textarea } from '@sentropic/design-system-svelte';
  import { entropicTheme } from '@sentropic/design-system-themes';
  import Explorer from './Explorer.svelte';
  import { presentation } from './presentation-fr.js';
  import Choices from './Choices.svelte';
  import mermaid from './.generated/mermaid.json';
  import data from './.generated/data.json';
  const titles = ['Décision & périmètre', 'Existant & incertitudes', 'Enjeux & responsabilités', 'Trois options', 'Avis & contre-arguments', 'Bascule & retour arrière', 'Critères de réussite', 'Points à compléter'];
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

<ThemeProvider theme={entropicTheme}>
  <AppShell><Container size="full" padding={false}>
    <main class="dossier">
      <header class="masthead">
        <Flex justify="between" align="center" wrap gap={2}>
          <span class="eyebrow">h2a Focus · dossier de décision · Immo / Geo / Kubernetes</span>
          <Badge tone="warning">INCOMPLET · consultation, aucun démarrage</Badge>
        </Flex>
        <h1>Des nouveaux PV<br>aux signaux visibles.</h1>
        <p class="lede">Clarifier le refresh et la sortie de MinIO/SCW avant de lancer les travaux. Même ressource, même identité, d’un diagramme à l’autre.</p>
        <div class="truth-strip"><span><strong>Préprod</strong> API : MinIO · refresh : OVH</span><span><strong>Production</strong> stockage effectif non inventorié</span><span><strong>Acté</strong> chaîne Immo · TEM conservé</span></div>
      </header>
      <nav class="steps" aria-label="Sections du dossier">
        {#each titles as title, index}<button class:active={step === index} aria-current={step === index ? 'step' : undefined} onclick={() => step = index}><span>{index + 1}</span>{title}</button>{/each}
      </nav>
      <ProgressBar value={step + 1} max={8} label={`Section ${step + 1} sur 8`} size="sm" />
      <section class="decision-content">
        <div class="section-heading"><span class="eyebrow">{step + 1} / 8 · dossier D3 · 13 septembre 2026</span><h2>{titles[step]}</h2></div>
        <!-- The French reading surface links to the complete repository dossier. -->
        {#if step === 3}<Choices manifest={data.manifest} remarks={note} />{:else}<div class="prose" onclick={link} role="presentation">{@html html(presentation[step])}</div>{/if}
        <Button variant="ghost" size="sm" onclick={() => source = 'decision-dossier'}>Dossier source complet · références et qualification des faits</Button>
        {#if step === 4}<Button variant="secondary" onclick={() => source = 'decision-reviews'}>Lire les avis réels des reviewers</Button>{/if}
      </section>
      <Explorer graphs={data.graphs} />
      <section class="notes"><h2>Vos remarques · brouillon local</h2>
        <p>Cette page ne signe rien, ne crée aucune décision Track et ne lance aucun traitement. Les notes restent dans ce navigateur.</p>
        <Textarea label="Remarques sur les décisions et critères manquants" value={note} oninput={event => save(event.currentTarget.value)} rows={4} />
        <Flex align="center" gap={2}><Button variant="secondary" onclick={download}>Exporter mes remarques</Button><span role="status">{storageError ? 'Stockage local indisponible : exporter avant de fermer.' : saved ? 'Brouillon enregistré localement — non ratifié' : 'Aucune approbation enregistrée'}</span></Flex>
      </section>
      <footer><strong>Preuves embarquées · accès hors ligne</strong><div class="source-links">{#each ['architecture', 'storage-audit', 'service-provenance', 'continuation-audit', 'decision-dossier', 'decision-reviews', 'proposal'] as name}<button onclick={() => source = name}>{name}</button>{/each}</div>
        <p>Composants Focus, SvelteFlow natif intégral et boîtes parentId imbriquées. Tous les liens sont conservés ; absence de croisements d’arêtes non certifiée.</p>
      </footer>
    </main>
    {#if source}<dialog class="source-overlay" use:modal onclose={() => source = null} aria-label={`Source ${source}`}><section class="source-sheet"><Button variant="secondary" onclick={() => source = null}>Fermer la source</Button><div class="prose" onclick={link} role="presentation">{@html html(data.docs[source])}</div></section></dialog>{/if}
  </Container></AppShell>
</ThemeProvider>
