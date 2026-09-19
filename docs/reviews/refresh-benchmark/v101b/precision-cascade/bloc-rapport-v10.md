# Bloc d'entrée pour le rapport v10 — cascade de précision CP (astra-medium → vérification gemini-3.8 low)

Décision owner du 2026-09-19 : la cascade de référence est **astra-medium → vérification gemini-3.8
low**, nommée **« CP »**. La première cascade, sur astra-low, a servi à établir la méthode. Elle **sort
du rapport** : aucune ligne ni aucun point sur les graphiques. Ses données restent sur disque
(`precision-cascade/`, avec le bloc d'origine dans `bloc-rapport-v10-ancienne-cp-astra-low.md`).

Sources :
- CP : `precision-cascade-medium/` (mesures, familles, décisions brutes, sorties filtrées) ;
- consigne du filtre : `precision-cascade/prompt-filtre.md` (même fichier, même empreinte pour les deux
  cascades) ;
- notation : `oracle-v3/scores-100.json` et `tableau-f1-100.md` ;
- facteurs de siège : `burn/seat-observations.json`.
Référence : oracle v3 (674 unités, 100 documents).

## Ce qu'est ce bras

Les sorties d'astra-medium déjà archivées (99/100 acceptées, aucun nouvel appel Astra) sont relues par
gemini-low. Pour chaque acte, Gemini dit s'il est soutenu par le document, avec motif et extrait. **Il
n'ajoute rien**, et c'est garanti par l'outillage : la sortie filtrée est la sortie d'Astra moins les
actes jugés non soutenus avec motif. Les défauts sont asymétriques : sans décision valide, l'acte est
gardé. Ce n'est pas la cascade C2/C3, où Gemini remplace Astra en cas de refus.

## Ligne de classement (100 documents, sortie refusée = tout manqué)

| Variante | P | R | F1 | Rang |
|---|---:|---:|---:|---:|
| Stricte (non résolus neutralisés) | 0,483 | 0,531 | **0,506** | **1** (devant astra-medium 0,437 et astra-low 0,423) |
| Large (non résolus attendus) | 0,488 | 0,508 | 0,498 | 1 |
| Tolérante à l'étape (colonne séparée) | — | — | 0,618 (+80 correspondances) | — |
| Souple par intervalles (colonne séparée) | — | — | 0,514 (+6) | — |
| Diagnostic ROUGE-L (ne crédite rien) | — | — | 0,516 (+7) | — |

Avant / après le filtre, en stricte :

| | P | R | F1 | VP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| astra-medium seul | 0,370 | 0,533 | 0,437 | 359 | 611 | 315 |
| après filtre gemini-low (CP) | 0,483 | 0,531 | 0,506 | 358 | 383 | 316 |

- Précision **+11,3 points**, rappel **−0,1 point**, F1 **+6,9 points**. Le filtre supprime 37,3 %
  des fausses détections.
- 912 actes jugés, 229 retirés. Nature de l'acte retiré au regard de la référence :
  - 225 **actes faux** : retrait justifié ;
  - 4 **actes justes** : retrait erroné ;
  - 0 non résolu.
- **Coût en rappel : 1 unité de la référence perdue** (VP 359 → 358). Les 3 autres actes justes retirés
  doublonnaient des actes gardés.
- Contrôles : 7 actes gardés comme « soutenus » avec un extrait non retrouvé mot à mot (sur 683
  gardés) ; 0 identifiant inconnu ; 0 acte gardé faute de décision valide.
- **Couverture** : astra-medium n'a pas de sortie pour waterville-2026-04-07 (échec de transport,
  `UND_ERR_SOCKET`). Ce document est noté comme par le scoreur, toutes ses unités en manqué, avant
  comme après le filtre. C'est une différence de couverture, pas de qualité du filtre.

## Coût

| | API (USD) | Siège (USD) | Jetons | Latence par document P50 / P95 |
|---|---:|---:|---:|---:|
| astra-medium (bras consommé) | 46,43 | 2,0538 (× P) | 2 132 053 | 191,5 s / 323,2 s |
| passe gemini-low (99 appels) | 1,22 | 0,0464 (× G) | 1 305 290 | 2,7 s / 6,8 s |
| **Total CP, passage du banc** | **47,65** | **2,1002** | **3 437 343** | **193,4 s / 326,1 s** |
| **Total CP par document ayant une sortie (÷ 99)** | **0,48134** | **0,021214** | 34 721 | — |

Débit : 18,5 documents/heure par fil d'exécution (×4 en parallèle).

*Note sur le tableau.* Siège d'une passe = coût API × facteur de son fournisseur (méthode de la
section 8) :
- facteur Codex P = 0,04423502937 : ChatGPT pro-20x, 200 USD/mois ; burn mesuré de 125,21 USD d'API
  pour 12 points de quota hebdomadaire, × 52/12 ;
- facteur Google G = 0,03793111955 : AI Pro, 19,99 USD/mois ; burn mesuré de 9,22 USD pour 7,58 points.

**Convention de dénominateur** : comme sur les 30 lignes du tableau, les coûts par document sont
divisés par le **nombre de documents ayant une sortie**. astra-medium et CP n'ont que 99 sorties : ils
sont divisés par 99, pas par 100.

## Part du gain propre à la cascade — familles de motifs (déterministe, sans appel modèle)

Chaque motif de retrait est classé par mots-clés reproductibles. La règle et la liste nominative des
229 motifs sont dans `precision-cascade-medium/familles.json` et `familles.md`. Les trois familles :
- **A — règle** : le motif invoque la liste d'exclusions. **80 retraits.**
- **B — document** : le motif invoque le texte (seulement mentionné ou cité, rappel, texte antérieur,
  aucun acte ni étape dans la séance, doublon). **120 retraits.**
- **C — mixte ou inclassable** : compté à part, jamais réparti. **29 retraits.**

| Scénario (stricte) | P | R | F1 | Δ précision |
|---|---:|---:|---:|---:|
| astra-medium seul | 0,370 | 0,533 | 0,437 | — |
| **filtre B seul : gain propre à la cascade (majorant)** | **0,422** | 0,533 | **0,471** | **+5,2** |
| filtre A + B | 0,465 | 0,531 | 0,496 | +9,5 |
| filtre complet (mesuré) | 0,483 | 0,531 | 0,506 | +11,3 |

**À mettre en avant : +5,2 points de précision imputables à la relecture, sur +11,3 au total.**

Réserves sur ce partage :
- **B est un majorant.** Le critère « rappel historique / texte antérieur », qui porte l'essentiel de B
  (règlements de base cités comme règlement modifié), figure dans la consigne du filtre et dans les
  règles du corrigé, pas dans la consigne d'extraction des bras.
- Classement par mots-clés : les erreurs repérées ne sont pas corrigées après coup. Un exemple dans la
  première cascade : un motif classé A à cause du mot « administratif ».

## Limite à déclarer — alignement des consignes

La consigne du filtre définit « non_soutenu » notamment par « si l'acte relève des exclusions
(nominations, comptes, contrats de services, loisirs, entretien de voirie sans développement
explicite, simples dépôts de correspondance) » et « si ce n'est qu'un rappel historique ». C'est la
liste du corrigé : consigne PASSE de l'oracle v3, point 7, « Exclus : nominations, comptes, rapports
financiers, contrats et marchés de services, loisirs, entretien de voirie sans développement explicite,
simples dépôts de correspondance, avis publics génériques », et point 4 pour le rappel historique.

La consigne d'extraction des bras (contrat `immo-pv-extraction-v9`) **ne porte ni cette liste ni ce
critère**. Ses seules indications de périmètre sont « Emit only these node types: Source, Bylaw, Zone,
DesignationEvent, Signal, Constraint. », « If no supported fact is grounded in the PDF, return empty
nodes, edges, and evidence. » et « extract procedures, processes, components, tools, and cited
evidence. »

Vérification : `precision-cascade/verification-consigne-bras/`. La consigne a été régénérée hors ligne
depuis le module de profil gelé (sha256 65e06be3…). Le schéma est identique à l'empreinte gelée. Le
texte d'instruction diffère de 103 octets (graphify 0.10.0 sur l'hôte contre 0.18.0 au gel), et une
liste de plus de 200 caractères ne tiendrait pas dans cet écart.

**Expérience non faite.** Il s'agirait de redonner la liste d'exclusions et le critère « rappel
historique » à un extracteur, puis de le renoter, pour mesurer ce qu'un extracteur mieux instruit
obtiendrait seul. Coût estimé : un bras complet sur le siège Codex, de l'ordre de 40 à 47 USD
d'équivalent API. L'expérience demande une consigne hors gel explicitement nommée. **Elle n'a pas été
lancée.**

## Trois cas pour l'annexe (tous issus de CP)

**Retrait justifié, motif conforme** — Saint-Polycarpe, séance du 2026-01-19, page 1, acte A02
(Signal), « Vente des immeubles pour défaut de paiement de taxes — point à l'ordre du jour ».
Extrait : « AUTORISATION - ÉTAT RELATIF À LA VENTE DES IMMEUBLES POUR DÉFAUT DE PAIEMENT DE TAXES
MUNICIPALES ».
Motif gemini-low : « La vente pour défaut de paiement de taxes est une procédure fiscale/financière
exclue du champ de l'urbanisme et de l'aménagement foncier. »
La référence ne contient pas cet acte.

**Retrait justifié, motif contestable** — Lac-du-Cerf, séance du 2026-04-11, page 1, acte A01
(Signal), « Évaluation des terrains du projet de lotissement chemin Dicaire / St- Louis ».
Extrait : « 8.1 Octroi de contrat pour l’évaluation des terrains du projet de lotissement chemin
Dicaire / St- Louis ».
Motif gemini-low : « Il s'agit d'un simple octroi de contrat de services professionnels pour de
l'évaluation, ce qui relève des exclusions. »
La référence ne contient pas cet acte, donc le retrait est juste au regard du score. Le motif se
discute pourtant : le contrat porte explicitement sur un projet de lotissement, que les règles
incluent quand le développement est explicite.

**Retrait erroné** — Sainte-Brigide-d'Iberville, séance du 2026-06-01, page 1. L'unité de référence u02,
« Demande de prolongation prévue à la CPTAQ pour le projet éolien », a pour extrait « 6.6 Coopérative
Régionale d’Électricité de Saint0Jean-Baptiste de Rouville – projet éolien : demande de prolongation à
la CPTAQ ». L'acte A05 d'Astra qui la couvrait a été retiré avec le motif « Il s'agit d'un simple point
de correspondance/demande sans décision d'urbanisme ou acte municipal formel caractérisé. » Le motif
contredit une règle explicite du corrigé : un point d'ordre du jour atteste une étape prévue. C'est la
seule unité perdue par le filtre.

## Totaux cumulés sur les 30 lignes du tableau (CP incluse, première cascade exclue)

- Souple par intervalles : **+101** correspondances.
- Diagnostic ROUGE-L : **+117** ; rapprochées par les deux méthodes 66, par les intervalles seuls 35,
  par ROUGE-L seul 51.
- Tolérance d'étape : **+1 169**.
- 2 bras changent de rang entre stricte et large : astra-high (15 → 16) et astra-xhigh (16 → 15).
