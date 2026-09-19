# Calibration — corrigé v3 contre corrigé humain v2

Mesurée sur les 5 documents annotés à la main (36 unités humaines). Le corrigé humain n'est pas
présumé juste : chaque écart est arbitré par les trois modèles sur l'extrait du texte gelé.
Appariement : même document, même étape, et site verbatim partagé. Un à un.
Waterloo : corrigé humain partiel, précision N-A et unités v3 hors humain non arbitrées.

- Rappel du v3 sur l'humain : **0.889** (32/36 unités humaines des documents disponibles)
- Précision du v3 (4 documents complets) : **0.939** (31/33 unités v3)
- Écarts arbitrés : 10 ; écarts restants sans arbitrage : **0**

| Document | Humain | v3 | Appariées | Rappel | Précision |
|---|---:|---:|---:|---:|---:|
| lac-des-seize-iles-2026-09-agenda | 4 | 4 | 4 | 1.000 | 1.000 |
| saint-etienne-de-bolton-2026-08-04 | 17 | 17 | 17 | 1.000 | 1.000 |
| valcourt-2026-06-01-agenda | 6 | 6 | 6 | 1.000 | 1.000 |
| saint-barthelemy-2026-09-08 | 8 | 6 | 4 | 0.500 | 0.667 |
| waterloo-2026-08-18 | 1 | 15 | 1 | 1.000 | N-A |

## Écarts arbitrés

| Document | Point | Nature | Verdict | Motif (un arbitre) |
|---|---|---|---|---|
| saint-etienne-de-bolton-2026-08-04 | a02 | unité humaine absente du v3 | l'humain avait raison | La résolution 2026-08-156 (p. 13) dispose : « QUE le conseil municipal refuse, sur recommandation du CCU, la demande de dérogation mineure visant à réduire à 2,4 mètres la marge latérale de 3 mètres » |
| valcourt-2026-06-01-agenda | a01 | unité v3 absente de l'humain | non résolu (owner) | Le point 11.1, page 2, prévoit la « RÉVISION NÉCESSAIRE DU PROJET DE RÈGLEMENT SUR LES PRATIQUES AGROENVIRONNEMENTALES » : il s’agit d’un objet réglementaire explicite, et non d’un simple rappel histo |
| saint-barthelemy-2026-09-08 | a01 | non unanime | non résolu (owner) | La résolution 2026-09-203 accepte de « prolonger le réseau d'aqueduc afin de desservir quelques résidences supplémentaires », mais ne constate aucun objet réglementaire ni acte foncier explicite. Le d |
| saint-barthelemy-2026-09-08 | a02 | unité humaine absente du v3 | non résolu (owner) | À la page 4, le dispositif de la résolution 2026-09-189 indique que le règlement 738-26 permettant les constructions accessoires en cour avant des propriétés riveraines « soit et est adopté ». L'absen |
| saint-barthelemy-2026-09-08 | a03 | unité humaine absente du v3 | non résolu (owner) | À la page 5, la résolution 2026-09-191 dispose que « le premier projet de règlement 739-26 » relatif aux immeubles à logements dans les zones R-7 et R-8 « soit et est adopté ». Cette étape actuelle es |
| saint-barthelemy-2026-09-08 | a04 | unité humaine absente du v3 | le v3 avait raison | Le considérant selon lequel la récupération du matricule « facilitera le développement de certains terrains dans ce secteur » motive l'achat du matricule 2723-93-7328 autorisé par la résolution 2026-0 |
| saint-barthelemy-2026-09-08 | a05 | unité v3 absente de l'humain | non résolu (owner) | Le titre « ADOPTION DU RÈGLEMENT NUMÉRO 738-26 » de la page 3 et le dispositif « soit et est adopté » de la page 4 appartiennent à la même résolution 2026-09-189, déjà retenue sous a02. Le fait relevé |
| saint-barthelemy-2026-09-08 | a06 | unité v3 absente de l'humain | non résolu (owner) | Le titre « ADOPTION DU PREMIER PROJET DE RÈGLEMENT NUMÉRO 739-26 » à la page 4 introduit la résolution 2026-09-191 dont le dispositif figure à la page 5, retenu sous a03. Il ne s'agit ni d'un autre pr |
| saint-barthelemy-2026-09-08 | a07 | unité v3 absente de l'humain | le v3 avait raison | La résolution 2026-09-194 autorise expressément la signature des documents nécessaires à « la vente des immeubles identifiés par les matricules 3220-74-4030 et 3220-73-6695 » : le second immeuble est  |
| saint-barthelemy-2026-09-08 | a08 | unité v3 absente de l'humain | le v3 avait raison | À la page 7, la résolution 2026-09-195 autorise la signature des documents nécessaires à « l'achat de l'immeuble identifié par le matricule 2723-93-7328 », correspondant à une portion de la Montée du  |

## Unités humaines manquées par la référence finale

- saint-barthelemy-2026-09-08 · S738 · adoption · p.4 · Adoption 738-26 : accessoires en cour avant au bord des lacs · arbitré
- saint-barthelemy-2026-09-08 · S739P · projet_reglement · p.5 · Premier projet 739-26 : densification R-7 et R-8 · arbitré
- saint-barthelemy-2026-09-08 · S195 · adoption · p.7 · Acquisition Montée du Lac-Robert, développement de terrains · arbitré
- saint-barthelemy-2026-09-08 · S203 · adoption · p.10 · Aqueduc rang York vers Saint-Cuthbert pour résidences supplémentaires · arbitré

## Unités de la référence finale absentes du corrigé humain

- saint-barthelemy-2026-09-08 · saint-barthelemy-2026-09-08#u05 · adoption · p.6 · Vente autorisée du matricule 3220-73-6695 près du Camping du Vieux Moulin — sans aménagement permanent · arbitré
- saint-barthelemy-2026-09-08 · saint-barthelemy-2026-09-08#u06 · adoption · p.7 · Acquisition autorisée d’une portion de la Montée du Lac-Robert — matricule 2723-93-7328 · arbitré

