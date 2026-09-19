# Bloc d'entrée pour le rapport v10 — cascade de précision astra-low → gemini-low

Sources : `precision-cascade/mesures.json` et `mesures.md`, `oracle-v3/scores-100.json` et
`tableau-f1-100.md`, `v101b/costs.md`. Référence : oracle v3 (`oracle-v3/consensus.json`, 674 unités,
100 documents).

## Ce qu'est ce bras

« CP (astra-low → gemini-low, cascade de précision) » : les sorties d'astra-low déjà archivées
(100/100 acceptées, aucun nouvel appel Astra) sont relues par gemini-low. Pour chaque acte produit par
Astra, Gemini dit s'il est soutenu par le document, avec motif et extrait. **Il n'ajoute rien** :
c'est garanti par l'outillage, la sortie filtrée étant la sortie d'Astra moins les actes jugés non
soutenus avec motif. Ce n'est pas la cascade C2/C3, où Gemini remplace Astra en cas de refus.

## Ligne de classement (100 documents, sortie refusée = tout manqué)

| Variante | P | R | F1 | Rang |
|---|---:|---:|---:|---:|
| Stricte (non résolus neutralisés) | 0,478 | 0,490 | **0,484** | 1 (devant astra-medium 0,437, astra-low 0,423) |
| Large (non résolus attendus) | 0,481 | 0,465 | 0,473 | 1 |
| Tolérante à l'étape (colonne séparée) | — | — | 0,598 (+78 correspondances) | — |
| Souple par intervalles (colonne séparée) | — | — | 0,499 (+10 correspondances) | — |
| Diagnostic ROUGE-L (ne crédite rien) | — | — | 0,504 (+14) | — |

Avant / après le filtre, en stricte :

| | P | R | F1 | VP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| astra-low seul | 0,372 | 0,490 | 0,423 | 330 | 558 | 344 |
| après filtre gemini-low | 0,478 | 0,490 | 0,484 | 330 | 360 | 344 |

- Précision **+10,7 points**, rappel **+0,0 point**, F1 **+6,1 points**.
- 888 actes jugés, 198 retirés. Nature de l'acte retiré au regard de la référence :
  - 197 **actes faux** : retrait justifié ;
  - 1 **acte juste** : retrait erroné, sans coût (voir ci-dessous) ;
  - 0 non résolu.
- **Coût en rappel : 0 unité de la référence perdue** (VP 330 → 330). Le seul acte juste retiré (L'Avenir,
  2026-05-04, A03, « Adoption de l'amendement de zonage 797-26 ») doublonnait un acte gardé (A01) qui
  couvre la même unité.
- Contrôles :
  - 11 actes gardés comme « soutenus » avec un extrait non retrouvé mot à mot (sur 690 gardés) ;
  - 0 identifiant inconnu ;
  - 0 acte gardé faute de décision valide.

## Coût (équivalent API, 100 documents)

| | USD | Latence par document, P50 / P95 |
|---|---:|---:|
| astra-low (bras consommé, `costs.md`) | 40,72 | 150,6 s / 323,2 s |
| passe gemini-low (100 appels) | 1,19 | 2,5 s / 5,7 s |
| **Total du bras CP** | **41,91** | **153,9 s / 328,8 s** (somme par document) |

Coût en siège, méthode de la section 8 du rapport : coût API × facteur du fournisseur. Facteur Codex
P = 0,0442350 (ChatGPT pro-20x, 200 USD/mois, burn mesuré : 125,21 USD d'API pour 12 points de quota
hebdomadaire, × 52/12). Facteur Google G = 0,0379311 (AI Pro, 19,99 USD/mois, burn mesuré : 9,22 USD
pour 7,58 points). Calcul : astra-low 40,72 × P = 1,8013 USD, plus passe 1,1946 × G = 0,0453 USD,
soit **1,8466 USD** pour 100 documents (18,47 USD pour 1 000). Jetons cumulés : 2 023 478 + 1 282 754 = 3 306 232.
Débit : 22,6 documents/heure par fil d'exécution (×4 en parallèle).

Soit +2,9 % de coût et +2,2 % de latence médiane pour +10,7 points de précision.

## Limite à déclarer — alignement des consignes

La consigne du filtre (`precision-cascade/prompt-filtre.md`) définit « non_soutenu » notamment par :
« si l'acte relève des exclusions (nominations, comptes, contrats de services, loisirs, entretien de
voirie sans développement explicite, simples dépôts de correspondance) ». C'est la liste du corrigé :
consigne PASSE de l'oracle v3, point 7 : « Exclus : nominations, comptes, rapports financiers, contrats
et marchés de services, loisirs, entretien de voirie sans développement explicite, simples dépôts de
correspondance, avis publics génériques. »

La consigne d'extraction des 26 bras (contrat `immo-pv-extraction-v9`) **ne porte pas cette liste**.
Ses seules indications de périmètre sont « Emit only these node types: Source, Bylaw, Zone,
DesignationEvent, Signal, Constraint. », « If no supported fact is grounded in the PDF, return empty
nodes, edges, and evidence. » et, dans le guidage générique du document, « extract procedures,
processes, components, tools, and cited evidence. »

**Une part du gain de précision vient donc de cet alignement sur les règles du corrigé**, et pas du
seul fait de relire : voir le chiffrage par familles ci-dessous (+4,7 points imputables à la relecture,
majorant, sur +10,7).

Vérification :
- consigne d'extraction régénérée hors ligne, sans appel modèle, à partir du module de profil gelé
  (`refresh-profile.ts`, sha256 65e06be3…, identique au manifeste) et du profil d'ontologie :
  `precision-cascade/verification-consigne-bras/` ;
- le schéma régénéré est identique octet pour octet à l'empreinte gelée ;
- le texte d'instruction diffère de 103 octets de l'empreinte gelée, sans doute parce que la version de
  graphify installée sur l'hôte (0.10.0) n'est pas celle du gel (0.18.0) ;
- les mots de la liste (nominations, loisirs, comptes, voirie, correspondance, contrats) n'y
  apparaissent que dans le texte du procès-verbal lui-même ;
- une liste d'exclusions de cette longueur (plus de 200 caractères) ne tiendrait pas dans l'écart de
  103 octets.

## Part du gain propre à la cascade — familles de motifs (déterministe, sans appel modèle)

Chaque motif de retrait est classé par mots-clés reproductibles. La règle et la liste nominative des
198 motifs sont dans `precision-cascade/familles.json` et `familles.md`, pour que le partage soit
contestable. Les trois familles :
- **A — règle** : le motif invoque la liste d'exclusions (fiscalité, nominations, comptes, contrats
  de services, loisirs, voirie, correspondance, avis génériques, « pas un acte d'urbanisme »). C'est
  un gain qu'une consigne mieux alignée aurait pu donner à l'extracteur seul. **73 retraits.**
- **B — document** : le motif invoque le texte (seulement mentionné ou cité, rappel, texte antérieur,
  aucun acte ni étape dans la séance, doublon). C'est le gain propre à la relecture. **101 retraits.**
- **C — mixte ou inclassable** : les deux familles, ou aucune. Compté à part, jamais réparti.
  **24 retraits.**

| Scénario (stricte, 100 documents) | P | R | F1 | VP | FP | Δ précision |
|---|---:|---:|---:|---:|---:|---:|
| astra-low seul | 0,372 | 0,490 | 0,423 | 330 | 558 | — |
| **filtre B seul : gain propre à la cascade** | **0,419** | 0,490 | **0,452** | 330 | 457 | **+4,7** |
| filtre A + B (sans C) | 0,462 | 0,490 | 0,476 | 330 | 384 | +9,0 |
| filtre complet (mesuré) | 0,478 | 0,490 | 0,484 | 330 | 360 | +10,7 |

**À mettre en avant : +4,7 points de précision imputables à la relecture, sur +10,7 au total.** La
famille A ajoute +4,3 points et la famille C +1,6. Aucun scénario ne perd de rappel.

Réserves sur ce partage :
- **B n'est pas entièrement indépendant de la consigne.** Le critère « rappel historique / texte
  antérieur », qui porte l'essentiel de B (règlements de base cités comme règlement modifié), figure
  dans la consigne du filtre (« si ce n'est qu'un rappel historique ») et dans les règles du corrigé
  (point 4). La consigne d'extraction des bras ne l'énonce pas. Les +4,7 points sont donc un **majorant**
  du gain propre à la relecture, pas une mesure pure.
- Classement par mots-clés : une erreur relevée à la relecture de l'échantillon. Frontenac A12
  (« simple mention d'un sujet sans décision ») est classé A à cause du mot « administratif » ; ce
  classement joue contre la cascade. Les 24 motifs de C sont pour la plupart des « hors urbanisme »
  qui contiennent aussi « sans acte… » ; ils sont laissés en C plutôt que répartis.

**Expérience non faite.** La question « combien de ce gain un extracteur mieux instruit obtiendrait-il
seul ? » reste ouverte. L'expérience qui trancherait serait de redonner la liste d'exclusions et le
critère « rappel historique » à un extracteur, puis de le renoter. Ordre de grandeur : un bras
astra-low complet, soit 100 appels sur le siège Codex et environ 40,72 USD d'équivalent API (coût du
bras astra-low dans `costs.md`), avec un effet sur le quota hebdomadaire Codex non mesuré. Elle
demande aussi de modifier la consigne gelée du contrat v9, donc un bras hors gel explicitement
nommé. **Elle n'a pas été lancée.**

## Deux cas pour l'annexe

**Retrait justifié** — Saint-Polycarpe, séance du 2026-01-19, page 1, acte A02 (Signal),
« Vente des immeubles pour défaut de paiement de taxes ».
Extrait : « AUTORISATION - ÉTAT RELATIF À LA VENTE DES IMMEUBLES POUR DÉFAUT DE PAIEMENT DE TAXES
MUNICIPALES ».
Décision gemini-low : non soutenu — « La vente d'immeubles pour non-paiement de taxes relève de la
fiscalité/recouvrement municipal et des exclusions, et ne constitue pas un acte d'urbanisme ou
d'aménagement foncier. »
La référence ne contient pas cet acte : retrait justifié, motif conforme aux règles.

**Retrait justifié, motif contestable** — Lac-du-Cerf, séance du 2026-04-11, page 1, acte A01
(Signal), « Évaluation des terrains du projet de lotissement chemin Dicaire / St-Louis ».
Extrait : « 8.1 Octroi de contrat pour l’évaluation des terrains du projet de lotissement chemin
Dicaire / St- Louis ».
Décision gemini-low : non soutenu — « Il s'agit d'un simple octroi de contrat de services
professionnels pour une évaluation de terrains, ce qui relève des exclusions (contrats de services). »
La référence ne contient pas cet acte : le retrait est **juste au regard du score**. Le motif se
discute pourtant : le contrat porte explicitement sur un projet de lotissement, et les règles
incluent les actes fonciers et le lotissement quand le développement est explicite. Le filtre a
appliqué l'exclusion « contrats de services » au pied de la lettre, là où un lecteur y verrait un
signal de développement.

## Totaux cumulés sur tous les bras (ligne CP seule, avant CPM — remplacés plus bas), `tableau-f1-100.md`

- Souple par intervalles : **+105** correspondances.
- Diagnostic ROUGE-L : **+124** ; rapprochées par les deux méthodes 70, par les intervalles seuls 35,
  par **ROUGE-L seul 54**.
- Tolérance d'étape : **+1 167**.
- 2 bras changent de rang entre stricte et large.

## CPM (astra-medium → gemini-low, cascade de précision) — même filtre, mot pour mot

Même consigne (même fichier `precision-cascade/prompt-filtre.md`, même empreinte), mêmes garde-fous,
mêmes défauts asymétriques, aucun appel Astra. Livrables : `precision-cascade-medium/`.

**CPM passe devant CP**, en stricte comme en large. Le gain de rappel d'astra-medium n'est pas mangé
par ses fausses détections : le filtre en retire la même proportion.

| Variante (100 documents) | CPM P | CPM R | CPM F1 | CP F1 |
|---|---:|---:|---:|---:|
| Stricte | 0,483 | 0,531 | **0,506** (1er) | 0,484 (2e) |
| Large | 0,488 | 0,508 | 0,498 (1er) | 0,473 (2e) |
| Tolérante à l'étape | — | — | 0,618 (+80) | 0,598 (+78) |
| Souple par intervalles | — | — | 0,514 (+6) | 0,499 (+10) |
| Diagnostic ROUGE-L | — | — | 0,516 (+7) | 0,504 (+14) |

Avant / après, en stricte :

| | P | R | F1 | VP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| astra-medium seul | 0,370 | 0,533 | 0,437 | 359 | 611 | 315 |
| après filtre gemini-low | 0,483 | 0,531 | 0,506 | 358 | 383 | 316 |

- Précision +11,3 points, rappel −0,1 point, F1 +6,9 points.
- 912 actes jugés, 229 retirés (37,3 % des fausses détections supprimées, contre 35,5 % pour CP) :
  225 actes faux (retrait justifié), 4 actes justes (retrait erroné), 0 non résolu.
- **Coût en rappel : 1 unité perdue** (VP 359 → 358). Sainte-Brigide-d'Iberville, 2026-06-01, page 1,
  unité u02 « Demande de prolongation prévue à la CPTAQ pour le projet éolien » (extrait « 6.6
  Coopérative Régionale d’Électricité de Saint0Jean-Baptiste de Rouville – projet éolien : demande de
  prolongation à la CPTAQ »). L'acte A05 a été retiré avec le motif « simple point de
  correspondance/demande sans décision d'urbanisme ». C'est un retrait erroné : un point d'ordre du
  jour atteste une étape prévue. Les 3 autres actes justes retirés doublonnaient des actes gardés.
- Contrôles : `supported_ungrounded` 7 (sur 683 gardés), identifiants inconnus 0, actes gardés faute
  de décision valide 0.
- **Couverture** : astra-medium n'a pas de sortie pour waterville-2026-04-07 (échec de transport,
  `UND_ERR_SOCKET`). Ce document est noté comme le fait le scoreur, toutes ses unités en manqué, avant
  comme après le filtre. C'est une différence de couverture, pas de qualité (99/100 contre 100/100 pour CP).

Familles de motifs (même règle publiée, `precision-cascade-medium/familles.md`) : **A 80 · B 120 · C 29**.

| Scénario (stricte) | P | R | F1 | Δ précision |
|---|---:|---:|---:|---:|
| astra-medium seul | 0,370 | 0,533 | 0,437 | — |
| **filtre B seul : gain propre à la cascade (majorant)** | **0,422** | 0,533 | **0,471** | **+5,2** |
| filtre A + B | 0,465 | 0,531 | 0,496 | +9,5 |
| filtre complet (mesuré) | 0,483 | 0,531 | 0,506 | +11,3 |

Coût cumulé :

| | API (USD) | Siège (USD) | Jetons | Latence par document P50 / P95 |
|---|---:|---:|---:|---:|
| astra-medium | 46,43 | 2,0538 (× P) | 2 132 053 | 191,5 s / 323,2 s |
| passe gemini-low (99 appels) | 1,22 | 0,0464 (× G) | 1 305 290 | 2,7 s / 6,8 s |
| **Total CPM, passage de 100 documents** | **47,65** | **2,1002** | **3 437 343** | **193,4 s / 326,1 s** |

Dénominateur : astra-medium n'a produit que 99 sorties, et la passe n'a donc traité que 99
documents. Par document traité, c'est 0,48134 USD d'API et **0,021214 USD de siège** (÷ 99, même
convention que la colonne « API/doc » de `costs.md` et que le 0,02074 publié pour astra-medium). Par
document du banc, c'est 0,4765 USD et 0,021002 USD (÷ 100). Il faut choisir une convention et s'y
tenir sur toute la colonne.

Débit : 18,5 documents/heure par fil d'exécution (×4 en parallèle), contre 22,6 pour CP. Face à CP,
CPM coûte +5,74 USD d'API (+0,25 USD de siège) et +39,5 s de latence médiane par document, pour +2,2 points
de F1 en stricte.

La même limite d'alignement des consignes s'applique : la liste d'exclusions et le critère « rappel
historique » sont dans le filtre, pas dans l'extracteur. L'expérience de contrôle n'a pas été faite.

## Totaux cumulés sur tous les bras (lignes CP et CPM incluses)

Souple par intervalles +111 ; diagnostic ROUGE-L +131 (rapprochées par les deux méthodes 73, par les
intervalles seuls 38, par ROUGE-L seul 58) ; tolérance d'étape +1 247 ; 2 bras changent de rang entre
stricte et large.
