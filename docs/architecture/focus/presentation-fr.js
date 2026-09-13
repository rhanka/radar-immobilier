// French owner-facing D8 presentation; English repository sources remain embedded.
export const presentation = [
`[ARCHITECTURE AVANT] Le premier schéma complet conserve la capture du 13
septembre : accès prod/préprod et SSO, Immo, Geo, cluster Kubernetes, PostgreSQL,
objets et poste LLM. L’API préprod utilise encore MinIO pour RAW/DOCS; le graphe
de refresh est sur OVH et le traitement LLM dépend du poste.

Toutes les boîtes et tous les composants sont visibles ensemble. Chaque élément
porte une icône, sa provenance repo et son rôle. [Source AVANT](architecture.md).`,
`[ARCHITECTURE APRÈS] Le second et dernier schéma complet montre la cible : RAW
et DOCS sur OVH, refresh Immo autonome avec Graphify/llm-mesh, services Geo et
tenants Immo/Geo sur un b3-8 existant. **SCW TEM reste présent** tant que son
remplacement n’est pas validé.

Cette cible n’est pas déployée. T3 reste NO-GO tant que T2, le rightsizing, les
contraintes de placement et l’étape deux nœuds ne sont pas acceptés.
[Source APRÈS](transitions-target.md).`,
`[DELTA FACTUEL · PAS UN TROISIÈME GRAPHE] Graphify **0.18.0** est intégré et
**Luna high** sélectionné. Le premier run Kubernetes a échoué avant l’appel LLM
car l’entrée choisie était au format HTML, pas PDF. En préprod, RAW et DOCS sont
actifs sur OVH. DOCS a une parité exacte de **59 017 objets / 12 534 514 457
octets**, manifeste **52646a7b…0425**, **failed=0**. MinIO et son PVC data 40 Gi sont
retirés; le PVC de migration/checkpoint reste. La production T2 est en cours.

Ces faits expliquent l’écart AVANT/APRÈS sans créer une troisième architecture.`,
`[GATES ET RETOUR ARRIÈRE] T1 : PDF valide → provider → Signal/PDF → rejeu →
schedule. T2 : inventaire → copie conditionnelle → parité → restauration →
fence → rebind, préproduction avant production. T3 : T2 complet → rightsizing →
contraintes → deux nœuds vérifiés → essai un nœud.

La suppression préprod est acceptée. La production doit franchir ses propres
gates avant sa suppression MinIO; aucune réduction du pool n’est autorisée.`,
`[DÉCISIONS DÉJÀ RATIFIÉES] L’ordre reste refresh T1 → objets T2 → un nœud T3.
Le corpus DOCS canonique reste l’ensemble production SCW exact de **59 017
keys+hashes**; le surplus préprod n’est pas migré. Le rollout reste préproduction
puis production. Le pipeline PV reste sous responsabilité Immo et SCW TEM reste
jusqu’à remplacement validé.

Les questions de la section suivante ne rouvrent aucune de ces décisions.`,
``,
`[PREUVES ET LIMITES] Les deux sources Mermaid sont rendues en SVG et en
SvelteFlow natif complet. Les sous-flows utilisent **parentId**; chaque nœud et
groupe doit avoir icône, rôle et provenance repo, avec échec fermé si un mapping
manque. Les relations, libellés, zooms, rendu hors ligne et presse-papiers sont
vérifiés.

Limites : T1 n’a pas atteint le provider, T2 production reste en cours et T3 est
gated. Préprod conserve le PVC de migration/checkpoint; API/MCP/UI restent 1/1.
Les réponses Focus restent locales et non ratifiées.`,
`[FACTURATION · EN DERNIER] La fenêtre jointe est **10 août → 13 septembre
inclus**, 35 jours / 840 heures. La projection infrastructure ratifiée porte sur
un b3-8 : 840 × 0,082 = **68,88 CAD**.

L’audit local alloue 139,337732 CAD à immo et 111,877705 CAD à geo, soit
**251,215438 CAD LLM** et une somme indicative de **320,095438 CAD**. Cette
allocation LLM n’est pas une facture fournisseur et sa ratification reste une
question **non critique** : l’absence de réponse ne bloque pas l’architecture.`,
];
