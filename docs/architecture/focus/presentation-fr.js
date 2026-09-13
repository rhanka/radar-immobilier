// French owner-facing D6 presentation; English repository sources remain embedded.
export const presentation = [
`[AVANT] La vue conservée comme référence décrit le déploiement observé plus tôt
le 13 septembre : API raw sur MinIO, fallback documents MinIO vide, historique
documents séparé, graphe/corpus sur OVH et étape LLM opérée depuis un poste.
Les URL **preprod.immo.sent-tech.ca** et **immo.sent-tech.ca**, leurs issuers SSO
et les frontières Immo/Geo/poc-k8s restent visibles. Ce n’est plus l’état le plus
récent de la journée; c’est la base explicite de comparaison. [Source avant](architecture.md).`,
`[TRANSITION EFFECTIVE · 13 SEPTEMBRE] La vue **Transition effective** assemble
uniquement les faits acquis. Graphify **0.18.0** est intégré et **Luna high** est
choisi. Le premier run Kubernetes a échoué avant l’appel LLM : l’entrée choisie
était \`.html\`, alors que le contrat exige un PDF. T1 est donc en validation, pas
accepté.

Pour T2, RAW a passé parité et l’API utilise **PP-RAW-OVH**. Le bucket et le Secret
DOCS préprod sont provisionnés. Les inventaires donnent 144 193 objets / 28,34 GB
en préprod contre 59 017 / 12 534 514 457 B dans la référence production SCW. Le tooling
de copie est commité, mais copie, parité/reprise et rebind DOCS restent ouverts.
La migration production a été lancée sans résultat final revendiqué. MinIO et **SCW TEM**
sont conservés jusqu’aux validations correspondantes. [État effectif](transitions-target.md).`,
`[T1 · GATE SUIVANT] Le prochain run doit choisir un vrai PDF, atteindre Luna
high via llm-mesh, publier un candidat frais gardé, projeter PostgreSQL atomiquement
et prouver un Signal typé avec son PDF exact. Un Job démarré, le choix du modèle
ou un graphe non vide ne suffit pas. Le rejeu idempotent et le schedule autonome
restent aussi à démontrer; le poste reste disponible pendant cette validation.
[Pipeline causal](proposal.md).`,
`[APRÈS T2 · CIBLE] Une fois DOCS copié, comparé, restaurable et rebound, les rôles
objets API préprod sont RAW et DOCS OVH. La référence initiale est exactement la
production SCW : **59 017 mêmes keys+hashes** doivent exister dans OVH prod et
préprod. Les 85 176 objets préprod en surplus ne sont pas migrés. Le chemin est
diff manifest → ensemble canonique prod → copie sélective → parité exacte → preuve
de reprise → retrait récupérable de tout MinIO. **TEM** reste conservé jusqu’à
remplacement validé. Cette vue est une cible, pas l’état actuel.`,
`[APRÈS T3 · CIBLE FINALE] La cible complète réunit les tenants Immo et Geo sur
**un b3-8 OVH existant**, avec URL/SSO, UI/API/MCP, PostgreSQL, CronJob refresh,
objets OVH et traitements Geo. Les icônes distinguent navigateur, K8s/CronJob,
S3, PostgreSQL, poste et LLM; chaque boîte affiche le repo responsable :
**radar-immobilier**, **geo** ou **poc-k8s**.

T3 n’a pas commencé et reste **NO-GO** : 4 095m/8 442 Mi de requests dépassent
1 840m/5 907,82 Mi allouables; anti-affinity et 16 PVC/15 Cinder RWO imposent le
chemin T2 terminé → rightsizing → contraintes réconciliées → deux nœuds vérifiés
→ essai un nœud.`,
`[GATES ET RETOUR ARRIÈRE] T1 : PDF valide → provider → Signal/PDF → rejeu →
schedule. T2 : inventaire → copie conditionnelle → parité → restauration → fence
→ rebind, préprod puis production. T3 : T2 complet → rightsizing/placement → deux
nœuds → un nœud préprod puis production.

Le rollback objet restaure ensemble graphe, checkpoint/version SQL, preuves et
input-set; aucun double writer ni transaction S3/SQL implicite. Une transition
partielle n’autorise ni suppression de MinIO, ni révocation, ni réduction du pool.`,
`[PREUVES ET LIMITES] Les huit sources Mermaid sont réellement rendues en SVG et
en SvelteFlow natif complet. Les sous-flows sont imbriqués par **parentId**; tous
les nœuds et parents ont une icône, un rôle et une provenance repo, avec échec
fermé si un mapping manque. La barre **Avant → Transition effective → Après T2
→ Après cible** conserve les trois niveaux de vérité et leurs gates.

Limites : aucun succès LLM au premier run, DOCS non copié/rebound, outcome prod
inconnu, T3 non commencé. Il n’existe aucune question de décision équilibrée dans
ce dossier; l’annexe exporte donc des faits/instructions JSON, sans faux choix.`,
`[FACTURATION · EN DERNIER] La dernière période fusionnée finit le **9 août**;
la jointure est donc **10 août → 13 septembre inclus**, 35 jours / 840 heures.
L’infrastructure est uniquement la projection d’**un b3-8** : 840 × 0,082 =
**68,88 CAD**. Les coûts observés de deux/trois nœuds sont du pass-through interne,
pas une ligne facturable.

L’audit local réel, dédoublonné selon la méthode précédente, alloue **139,337732
CAD à immo** et **111,877705 CAD à geo**, soit **251,215438 CAD LLM**. La somme
indicative infra + LLM est **320,095438 CAD**. Le LLM n’est pas artificiellement
abaissé : la fenêtre corrigée de 35 jours donne 7,1776 CAD/j, presque le niveau du
brouillon 30 jours (7,1581 CAD/j). Ce calcul est une allocation de sessions, pas
une ligne de facture fournisseur.`
];
