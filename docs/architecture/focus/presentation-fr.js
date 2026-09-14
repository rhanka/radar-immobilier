// French owner-facing D9 presentation; English repository sources remain embedded.
export const presentation = [
`[ARCHITECTURE AVANT · 9 AOÛT] Deux vues autonomes reconstruisent le point de
départ sans lui attribuer un runtime qui n’a pas été observé. La paire A montre
MinIO applicatif et les coordonnées SCW/registre encore déclarés. La paire B
montre la collecte, l’extraction Graphify et la projection lancées manuellement
depuis le poste; les CronJobs sont suspendus.

Chaque boîte porte son état, son niveau de preuve, une icône et sa provenance
de dépôt. Le libellé public est exactement **Navigateur utilisateur**.
[Source canonique](architecture.md).`,
`[ARCHITECTURE APRÈS · 13 SEPTEMBRE] La paire A montre les chemins applicatifs
sur OVH S3 et GHCR, sans dépendance runtime SCW sauf **SCW TEM**, exception
résiduelle explicitement conservée jusqu’à remplacement validé. Le cutover est
observé; la parité des attributs de destination, le rescan final et le balayage
global des dépendances historiques restent ouverts.

La paire B montre le CronJob causal autonome accepté en préproduction. Sa
production demeure **dormante jusqu’à promotion** et le modèle de souscription
reste **en attente de M1** : aucun gagnant n’est affirmé.
[Source canonique](architecture.md).`,
`[DELTA FACTUEL · DEUX PAIRES] A sépare le déplacement du stockage/registre de
l’exception TEM. MinIO n’est plus sur le chemin runtime applicatif observé;
OVH S3 et GHCR portent désormais les chemins courants. L’historique du 9 août
reste qualifié comme déclaré, observé ou inconnu nœud par nœud et relation par
relation.

B sépare l’automatisation du refresh de son activation en production. Graphify
0.18.0 et llm-mesh sont intégrés au workload; corpus et graphe sont des contrats
durables neutres vis-à-vis du fournisseur. Le trial Luna high de préproduction
ne sélectionne pas le modèle de production.`,
`[GATES ET RETOUR ARRIÈRE] Pour A, l’acceptation finale exige encore la parité
des attributs de destination, un rescan de la source et le balayage des
dépendances historiques. **SCW TEM reste autorisé** tant qu’un remplacement
n’a pas été validé. La réduction à un nœud reste gated après nettoyage,
remeasure, rightsizing, réconciliation des contraintes et étape deux nœuds.

Pour B, promotion et horaire de production restent bloqués jusqu’au benchmark
M1 apparié, à l’identité durable, au Signal/PDF typé, au rejeu exact et aux
preuves d’exécution planifiée.`,
`[DÉCISIONS DÉJÀ RATIFIÉES] L’ordre reste refresh T1 → objets T2 → un nœud T3.
Le corpus DOCS canonique reste l’ensemble production SCW exact de **59 017
keys+hashes**; le surplus préprod n’est pas migré. Le rollout reste
préproduction puis production. Le pipeline PV reste sous responsabilité Immo,
ses corpus et graphe restent neutres vis-à-vis du fournisseur, et SCW TEM reste
jusqu’à remplacement validé.

Les questions de la section suivante ne rouvrent aucune de ces décisions.`,
``,
`[PREUVES ET LIMITES] Quatre sources Mermaid canoniques sont rendues en quatre
SVG et quatre SvelteFlow natifs. Les sous-flows utilisent **parentId**; chaque
nœud et groupe possède icône, rôle et provenance repo. Les inventaires,
relations, libellés, tailles, zoom 100 %, rendu hors ligne et presse-papiers
sont contrôlés dans Chromium.

La reconstruction du 9 août s’ancre sur la dernière révision documentaire
first-parent de main avant la fin de cette journée; elle n’est pas transformée
en fait runtime. Le rapport précédent est localisé au commit historique
72b96666 sans affirmer qu’il appartient à l’ascendance de main.`,
`[FACTURATION · EN DERNIER] La fenêtre jointe est **10 août → 13 septembre
inclus**, 35 jours / 840 heures. La projection infrastructure porte sur un
b3-8 : 840 × 0,082 = **68,88 CAD**.

L’audit local alloue 139,337732 CAD à immo et 111,877705 CAD à geo, soit
**251,215438 CAD LLM** et une somme indicative de **320,095438 CAD**. Cette
allocation LLM est provisoire, non critique et non finale; elle n’est pas une
facture fournisseur.`,
];
