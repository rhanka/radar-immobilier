# Dossier de décision M1 v4 — actualisation rapport v8 finale

17 septembre 2026 · décision owner actée ; fichiers non commités.

## Décision finale et preuves historiques

**Décision finale : `gpt-6-astra`, effort low, en modèle principal ; `gemini-3.8-flash`, effort low, en repli.**

**Un choix de qualité assumé.** Astra low accepte **100/100 documents**, sans refus qualité, et atteint un **F1 net de 0,632**, très au-dessus de C2/C3 (**0,478**) et de Gemini low seul (**0,346**). Le F1 porte sur **4 documents annotés / 35 unités**, refus comptés en manqué ; sur 100 documents, il reste **N-A**.

**Surcoût assumé :** Astra low coûte **0,407 USD/document à l’API**, ou **0,018 USD/document au siège Codex Pro 20x**, contre **0,038** et **0,0014** pour Gemini low. Le coût siège est une allocation à pleine capacité, distincte de la facture fixe.

**Repli déjà prouvé :** Gemini low a été accepté dans le job à repli forcé du **17 septembre 2026** en préproduction (Waterloo, **1 877 ms**, raison `forced`). **Gemini high est écarté : 53/100 acceptés, 44 refus JSON**, contre 85/100 acceptés et 15 refus au total pour low.

**C2 et C3 restent des alternatives économiques écartées pour l’instant**, à réexaminer si le volume explose. Leurs lignes, points et mesures sont conservés ; elles ne constituent pas la décision finale.

**Historique de la cascade #719 — rejeu préproduction du 17 septembre 2026, après purge, sur 30 villes :** image `radar-api:d5d0c1a` ; **18 documents traités, 18 acceptés par Gemini au premier essai, zéro second essai, zéro bascule Astra**. Onze villes n’ont aucun appel modèle à cause de sources en erreur ; une ville n’a aucun document nouveau. **Zéro signal matérialisé.** Quota Gemini hebdomadaire affiché à **76 % avant et après** : aucune variation visible à la résolution du compteur, sans preuve d’une consommation nulle. Résultat communiqué par le conducteur ; aucun rejeu n’a été lancé pour cette rédaction.

Le parcours nominal est exercé ; le second essai et le repli restent non exercés dans ce rejeu. Zéro signal matérialisé ne valide pas la couverture métier finale.

## Comparaison corrigée

**Cascade / Gemini seul : +38 % de F1 net.** C2/C3 : **0,478**, Gemini low seul : **0,346**, sur les mêmes 35 unités / 4 documents, refus comptés en manqué. Acceptation sur 100 : 100 contre 85. F1 sur documents acceptés seulement, non comparable entre bras : 0,498 (4 documents) contre 0,518 (3). F1 net sur 100 : **N-A — oracle incomplet**.

**Limite :** les quatre sorties annotées de C2/C3 sont identiques et issues de Gemini, trois au premier appel et Saint-Étienne-de-Bolton au premier rejeu. Astra n’intervient sur aucun document de la référence ; le gain mesuré provient du rejeu. C2/C3 diffèrent par le coût, la vitesse et la répartition des traitements hors oracle ; leur différence de qualité reste inconnue sur ces documents.

**Suite recommandée :** annoter au moins `potton-2026-01-05`, `coteau-du-lac-2026-02-10` et `berthier-sur-mer-2026-03-24` (environ 10 unités chacun, **30 unités / 3–5 h estimées**, annotation et contrelecture). Mesurer ainsi le repli Astra et la différence C2/C3 sur les reçus existants.


| Configuration | Acceptés/100 | P net | R net | F1 net | API USD/doc | Siège alloué USD/doc | Moyenne s | Docs/h |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Astra low | **100** | **0,585** | **0,686** | **0,632** | 0,40724 | 0,01801 | 156,1 | 23,1 |
| C2 | **100** | 0,500 | 0,457 | 0,478 | 0,06895 | 0,00277 | 52,8 | 68,2 |
| C3 | **100** | 0,500 | 0,457 | 0,478 | **0,05427** | **0,00211** | **47,1** | **76,4** |

P/R/F1 nets : 4 documents, 35 unités attendues, refus inclus. Sur 100 : N-A. Siège à pleine capacité ; deux abonnements dédiés C2/C3 = 219,99 USD/mois. Coûts API : usages connus, incident réseau sans usage non chiffré.

**Mesure nette après acceptation :** TP = unités attendues retrouvées dans les sorties acceptées ; FP = groupes supplémentaires ou doublons ; tout document refusé ajoute ses unités attendues aux FN. Précision = TP/(TP+FP), rappel = TP/(TP+FN), F1 = 2TP/(2TP+FP+FN). Le dénominateur attendu reste fixe, même quand une sortie est refusée. Les 100 documents sont inventoriés, mais seuls **4 ont un oracle complet, soit 35 unités** ; Waterloo est partiel et 95 documents sont sans annotation. **P/R/F1 nets sur 100 : N-A (source-gap).** Les chiffres et le graphique nets portent donc sur ces 4 documents, sans assimiler une annotation absente à zéro acte attendu.

**Pourquoi Luna high n’est plus en tête :** ses refus de deux documents annotés comptent désormais leurs 25 unités attendues en manqué ; avec TP = 9, FP = 4 et FN = 26, son rappel net tombe à **0,257** et son F1 net à **0,375**, contre **0,632 pour Astra low**. Ses 57 refus sur 100 restent mesurés séparément ; multiplier le rappel brut par 43 % ne donnerait pas le rappel documentaire net.

**Siège corrigé :** coût API × facteur fournisseur, **0,044235 Codex**, **0,037931 Gemini**. Cohortes : 125,20533 USD/12 points et 9,21858 USD/7,58 points. Écarts aux approximations 96/9,78 USD : +30,4 %/−5,7 % ; les reçus de la cohorte prévalent sur les moyennes de campagne. Réserve temporelle Codex : un reçu finit trois minutes après la borne annoncée ; le retirer change le facteur de +0,7 %. L’ancienne allocation par jetons communs surestimait les bras bon marché : Luna high passe de 0,0246 à **0,000882 USD/doc**, Astra low à **0,018014**, Gemini low à **0,001428**. Facturation fixe et coût à saturation restent distincts.

C2 : API 5,9× moins coûteuse qu’Astra seul ; moyenne 52,8 s contre 156,1 s, incident réseau de 2 284,798 s inclus. F1 net 0,478 contre 0,632 (−24,4 %) sur la petite référence ; macro historique 0,498 contre 0,584 (−14,8 %). Aucun score de qualité sur 100 n’est extrapolé.

## Rejeu et limites

**Rejeu historique corrigé :** Gemini low : 15 refus, 15 rejoués, 10 récupérés au premier rejeu, 13 cumulés au deuxième (87 %) ; medium : 21 refus, 16 rejoués, 11 récupérés. Potton et Coteau-du-Lac échouent à tous les essais Gemini low observés ; Astra les couvre. C2 : 95 Gemini/5 Astra ; C3 : 98/2. C3 conserve un rejeu après incident réseau et ne représente pas la politique de bascule immédiate #719.

Reparse hors ligne : 125 refus JSON → 5 JSON valides → 2 acceptés. Aucun nouvel appel modèle. Oracle complet : quatre documents ; juges : Terra 605/605, Opus 149/605, 71/149 notes égales, sans validation statistique de l’oracle.

## Économie et suites mesurables

Seuils stricts des abonnements dédiés : Gemini low 532 documents/mois, Astra low 492 ; C2 avec deux sièges 3 191, C3 4 054. Ces seuils restent dans les capacités projetées corrigées. À 1 000 documents, deux sièges dédiés coûtent 219,99 USD, au-dessus des 68,95 USD API connus de C2 ; cela ne contredit pas la remise sur consommation à pleine capacité.

**Suites confiées au conducteur :** relire, commiter et pousser le rapport ; basculer la politique vers Astra low avec repli Gemini low via PR, CI et déploiement préproduction ; rejouer en préproduction, lier le PDF dans la carte #703 et y publier les nouveaux signaux dès qu’ils sont mesurés. Cette livraison ne prouve ni cette bascule ni ce nouveau rejeu. Les preuves antérieures PR #714 restent historiques et distinctes du rejeu de la cascade #719.

## Traçabilité

[Rapport](https://github.com/rhanka/radar-immobilier/blob/main/docs/reports/benchmark-v101b-2026-09-17.md) · [PDF](https://github.com/rhanka/radar-immobilier/blob/main/docs/reports/benchmark-v101b-2026-09-17.pdf) · [Dossier M1](https://github.com/rhanka/radar-immobilier/blob/main/docs/spec/reports/DOSSIER_DECISION_M1_V4_2026-09-17.md)

Recalcul : `tmp/measure-v6.mjs`, `tmp/qa/v6-measure.json` ; rendus : `tmp/build-v8.py`. Calculatrice et tests corrigés avec étalonnage API des observations ; reçus et manifeste inchangés. Liens main destinés à l’intégration ultérieure. Aucun commit, PR ou commentaire publié.
