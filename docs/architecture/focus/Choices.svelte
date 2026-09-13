<script>
  import { onMount } from 'svelte';
  import { Badge, Button, Flex, Stack, Textarea, Tile } from '@sentropic/design-system-svelte';
  import { responsePack } from './choices.js';
  let { manifest, remarks = '' } = $props();
  let note = $state(''), status = $state(''), copyError = $state('');
  let storageKey = $derived(`immo-focus-d6-instructions:${manifest.artifactInputHash}`);
  let json = $derived(JSON.stringify(responsePack(manifest, note, remarks, null), null, 2));
  onMount(() => { try { note = localStorage.getItem(storageKey) ?? ''; } catch { status = 'Lecture du commentaire local indisponible.'; } });
  function persist() { copyError = ''; try { localStorage.setItem(storageKey, note); status = 'Commentaire enregistré localement — aucune ratification créée.'; } catch { status = 'Sauvegarde locale indisponible : copiez ou téléchargez le JSON.'; } }
  const packText = () => JSON.stringify(responsePack(manifest, note, remarks, new Date().toISOString()), null, 2);
  async function copy() { copyError = ''; try { await navigator.clipboard.writeText(packText()); status = 'Instructions, preuves manquantes et commentaire copiés en JSON.'; } catch { copyError = 'Copie refusée par le navigateur. Le JSON reste sélectionnable et téléchargeable.'; } }
  function download() { const url = URL.createObjectURL(new Blob([packText()], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'immo-instructions-d6.json'; a.click(); URL.revokeObjectURL(url); }
</script>

<section class="choices" aria-labelledby="instruction-title">
  <h3 id="instruction-title">Annexe facturation · faits et calculs auditables</h3>
  <p><strong>Aucun choix DIRECT / USAGE / CAPACITY n’est demandé.</strong> La méthode précédente est conservée; cette annexe exporte les faits, calculs et preuves ouvertes sans créer une approbation.</p>
  <div class="option-grid" aria-label="Instructions de facturation D6">
    <Tile><Stack gap={3}><Flex justify="between" wrap gap={2}><Badge tone="success">Jointure vérifiée</Badge></Flex><h3>Fenêtre</h3><p><strong>10 août → 13 septembre inclus</strong>, 35 jours / 840 h. Le dernier rapport coûts fusionné finit le 9 août.</p><dl><div><dt>Bornes</dt><dd><code>2026-08-10T00:00:00-04:00</code> à <code>2026-09-14T00:00:00-04:00</code>.</dd></div><div><dt>Réserve</dt><dd>La jointure est prouvée dans Git; une facture externe différente n’est pas présente.</dd></div></dl></Stack></Tile>
    <Tile><Stack gap={3}><Flex justify="between" wrap gap={2}><Badge tone="success">68,88 CAD</Badge></Flex><h3>Infrastructure</h3><p>Projection d’<strong>un b3-8 BHS5</strong> : 840 × 0,082 CAD/h.</p><dl><div><dt>Exclus</dt><dd>Les deux/trois nœuds observés relèvent des coûts plateforme pass-through/internes, non facturables ici.</dd></div><div><dt>Nature</dt><dd>Projection cible, pas consommation fournisseur mesurée.</dd></div></dl></Stack></Tile>
    <Tile><Stack gap={3}><Flex justify="between" wrap gap={2}><Badge tone="neutral">251,215438 CAD</Badge></Flex><h3>LLM</h3><p>Sessions réelles dédoublonnées, mêmes abonnements, capacité, change et marge que le rapport précédent.</p><dl><div><dt>immo / geo</dt><dd>139,337732 / 111,877705 CAD.</dd></div><div><dt>Réserve</dt><dd>Allocation locale mesurée, pas ligne de facture fournisseur.</dd></div></dl></Stack></Tile>
  </div>
  <Textarea label="Commentaire du propriétaire sur les instructions ou preuves manquantes" helperText="Inclus dans le JSON local; ne crée ni approbation ni décision Track." value={note} rows={4} oninput={event => { note = event.currentTarget.value; persist(); }} />
  <Flex gap={2} wrap><Button variant="primary" onclick={copy}>Copier les instructions en JSON</Button><Button variant="secondary" onclick={download}>Télécharger les instructions en JSON</Button><Button variant="ghost" onclick={() => { note = ''; persist(); }}>Effacer le commentaire</Button></Flex>
  <p role="status">{copyError || status}</p>
  <details class="choice-json" open={Boolean(copyError)}><summary>Voir le JSON des instructions et preuves ouvertes</summary><textarea aria-label="JSON des instructions D6" readonly value={json} rows={16}></textarea></details>
</section>
<style>
  .choices { margin-block: 24px; } .option-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-block: 20px; }
  h3 { margin: 0; font-size: 1.15rem; } p, dl { font-size: .9rem; line-height: 1.5; } dl { margin: 0; } dl > div { margin-bottom: 12px; } dt { font-weight: 700; } dd { margin: 4px 0 0; }
  .choice-json textarea { width: 100%; margin-top: 16px; font-family: monospace; font-size: .8rem; } @media (max-width: 850px) { .option-grid { grid-template-columns: 1fr; } }
</style>
