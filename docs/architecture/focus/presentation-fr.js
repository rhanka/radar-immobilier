// French owner-facing presentation; complete repository sources remain embedded.
export const presentation = [
`[HÉBERGEMENT · TROIS ÉTATS] En juillet, avant la décision OVH, la plateforme
est sur Scaleway et rien n'est engagé. Au 10 août, environ 90 % est migré vers
OVH, mais le stockage objet passe encore par MinIO. Au 13 septembre,
préproduction et production sont sur OVH S3 sans MinIO. Scaleway TEM reste la
seule exception radar. [Source canonique](architecture.md).`,
`[PIPELINE · AVANT/APRÈS] Avant l'intégration, Graphify 2.3 s'exécute localement
sur le poste et l'orchestration manuelle empêche l'automatisation. Après,
radar-refresh-pv est un CronJob autonome à 05:17 UTC; Graphify 0.18.0 est une
bibliothèque, llm-mesh 0.19.1 s'exécute dans le processus et le keyring radar
est chiffré. Préproduction acceptée; production dormante jusqu'à la promotion
de la PR #682. [Source canonique](architecture.md).`,
`[DELTA FACTUEL] MinIO, son Service, ses PVC et six règles nommées ont disparu
de la préproduction et de la production. API, graphe et scrape utilisent OVH
S3. La copie canonique compte 59 017 objets et 12 534 514 457 octets, sans
nouvelle copie ni échec au contrôle final. Geo est à 100 % sur GHCR à
l'exécution.`,
`[GATES ET RETOUR ARRIÈRE] Le pipeline est accepté en préproduction mais sa
production reste dormante. La PR #682 est le point de promotion; ce dossier ne
l'affirme jamais effectuée. Le nœud r2-15 est créé et KEDA retiré, mais aucun
b3-8 n'est drainé : la consolidation n'est pas terminée.`,
`[DÉCISIONS DÉJÀ RATIFIÉES] OVH S3 remplace MinIO pour le runtime radar en
préproduction et production. TEM est conservé. Lorsque l'infrastructure sera
payable, la base est une seule r2-15 à 58,58 $ CAD/mois; le surcoût des trois
b3-8 est une erreur d'opérateur et ne sera pas facturé.`,
``,
`[PREUVES ET LIMITES] Cinq sources Mermaid sont rendues en cinq SVG et cinq
SvelteFlow natifs. Les sous-flows utilisent parentId; chaque nœud conserve son
état et sa provenance. Chromium contrôle zoom 100 %, facteur de pixels 1,
hauteur non nulle, nœuds dans la scène, arêtes tracées et ouverture file:// sans
réseau. Le rapport précédent est joint byte pour byte.`,
`[COÛTS] Payé à ce jour : 0,00 $ CAD. Les factures QC281819 et QC285954 sont à
0 $. Le crédit de 270 $ a absorbé 179,23 $; 90,77 $ ont expiré le 12 août.
Septembre représente environ 71,62 $ de valeur non facturée et le premier débit
réel est attendu vers le 1er octobre. L'allocation LLM reste provisoire, non
critique et non finale.`,
];
