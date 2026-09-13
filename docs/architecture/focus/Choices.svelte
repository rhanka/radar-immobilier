<script>
  import { onMount } from 'svelte';
  import { Badge, Button, Flex, Stack, Textarea, Tile } from '@sentropic/design-system-svelte';
  import { responsePack } from './choices.js';
  let { manifest, remarks = '' } = $props();
  let note = $state(''), status = $state(''), copyError = $state('');
  let storageKey = $derived(`immo-focus-d5-instructions:${manifest.artifactInputHash}`);
  let json = $derived(JSON.stringify(responsePack(manifest, note, remarks, null), null, 2));
  onMount(() => { try { note = localStorage.getItem(storageKey) ?? ''; } catch { status = 'Lecture du commentaire local indisponible.'; } });
  function persist() { copyError = ''; try { localStorage.setItem(storageKey, note); status = 'Commentaire enregistré localement — aucune ratification créée.'; } catch { status = 'Sauvegarde locale indisponible : copiez ou téléchargez le JSON.'; } }
  const packText = () => JSON.stringify(responsePack(manifest, note, remarks, new Date().toISOString()), null, 2);
  async function copy() { copyError = ''; try { await navigator.clipboard.writeText(packText()); status = 'Instructions, preuves manquantes et commentaire copiés en JSON.'; } catch { copyError = 'Copie refusée par le navigateur. Le JSON reste sélectionnable et téléchargeable.'; } }
  function download() { const url = URL.createObjectURL(new Blob([packText()], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'immo-instructions-d5.json'; a.click(); URL.revokeObjectURL(url); }
</script>

<section class="choices" aria-labelledby="instruction-title">
  <h3 id="instruction-title">Annexe facturation · instructions fixes, preuves ouvertes</h3>
  <p><strong>Aucun choix DIRECT / USAGE / CAPACITY n’est demandé.</strong> Le `null` D4 est conservé comme absence de vote. Cette annexe exporte les instructions du propriétaire et les éléments à vérifier, sans montant courant inventé.</p>
  <div class="option-grid" aria-label="Instructions de facturation D5">
    <Tile><Stack gap={3}><Flex justify="between" wrap gap={2}><Badge tone="warning">Période non fermée</Badge></Flex><h3>Fenêtre demandée</h3><p>Début = frontière réelle de la facture/du rapport précédent, encore non vérifiée. Fin = 13 septembre inclus, soit <code>2026-09-14T00:00:00-04:00</code> exclusif.</p><dl><div><dt>Cutoffs des preuves</dt><dd>Runtime architecture : 15:38Z. Avancement des transitions : 15:39Z. Le cutoff unifié livraison/tokens/facturation n’est pas gelé.</dd></div><div><dt>Transitions du 13</dt><dd>Dans la période demandée, distinguées entre observées et planifiées.</dd></div></dl></Stack></Tile>
    <Tile><Stack gap={3}><Flex justify="between" wrap gap={2}><Badge tone="warning">Montant inconnu</Badge></Flex><h3>Infrastructure</h3><p>Une seule projection b3-8 BHS5 au tarif observé de <strong>0,082 CAD/h</strong>.</p><dl><div><dt>Heures de période</dt><dd>Inconnues tant que le début réel n’est pas vérifié.</dd></div><div><dt>Projection courante</dt><dd>Inconnue. 720 h / 59,04 CAD est une ancienne illustration de 30 jours, jamais le montant de cette période.</dd></div></dl></Stack></Tile>
    <Tile><Stack gap={3}><Flex justify="between" wrap gap={2}><Badge tone="neutral">Dernière annexe</Badge></Flex><h3>LLM</h3><p>Compter plus tard les tokens avec les <strong>mêmes tarifs unitaires que la facture réelle du mois précédent</strong>.</p><dl><div><dt>Prérequis</dt><dd>Identifier la facture précédente réelle et ses tarifs; les exemples Wave plus anciens ne prouvent pas le dernier tarif.</dd></div><div><dt>D5</dt><dd>Aucun parsing des tokens, aucune nouvelle méthode d’allocation, aucun montant.</dd></div></dl></Stack></Tile>
  </div>
  <Textarea label="Commentaire du propriétaire sur les instructions ou preuves manquantes" helperText="Inclus dans le JSON local; ne crée ni approbation ni décision Track." value={note} rows={4} oninput={event => { note = event.currentTarget.value; persist(); }} />
  <Flex gap={2} wrap><Button variant="primary" onclick={copy}>Copier les instructions en JSON</Button><Button variant="secondary" onclick={download}>Télécharger les instructions en JSON</Button><Button variant="ghost" onclick={() => { note = ''; persist(); }}>Effacer le commentaire</Button></Flex>
  <p role="status">{copyError || status}</p>
  <details class="choice-json" open={Boolean(copyError)}><summary>Voir le JSON des instructions et preuves ouvertes</summary><textarea aria-label="JSON des instructions D5" readonly value={json} rows={16}></textarea></details>
</section>
<style>
  .choices { margin-block: 24px; } .option-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-block: 20px; }
  h3 { margin: 0; font-size: 1.15rem; } p, dl { font-size: .9rem; line-height: 1.5; } dl { margin: 0; } dl > div { margin-bottom: 12px; } dt { font-weight: 700; } dd { margin: 4px 0 0; }
  .choice-json textarea { width: 100%; margin-top: 16px; font-family: monospace; font-size: .8rem; } @media (max-width: 850px) { .option-grid { grid-template-columns: 1fr; } }
</style>
