v10 LOW : 1/5 acceptés (v9 : 3/5) · refus restants : `entity_citation_excerpt_too_long` (3), `ungrounded_pdf_excerpt` (1) · F1 macro=0,909

# Campagne T1 v10 — contrat d'extraction v6

## Résultat

Le contrôle Valcourt puis les cinq PDF ont été envoyés une seule fois à
Gemini 3.8 Flash LOW, avec un plafond de 65 536 tokens. Les six appels ont reçu
HTTP 200 et une fin SSE `STOP`. Le contrôle Valcourt et son cas de campagne sont
acceptés. Aucun retry n'a été envoyé et le plafond de six requêtes est atteint.

La campagne accepte 1/5 PDF, contre 3/5 en v9. Le seul F1 calculable est celui
de Valcourt : P=1,000, R=0,833 et F1=0,909; il constitue donc aussi la macro v10
sur les sorties acceptées. Cette macro n'est pas directement comparable à la
macro v9 de 0,558, qui portait sur trois sorties acceptées.

## Comparaison v9 ↔ v10 par PDF

| PDF | v9 accepté | P / R / F1 v9 | v10 accepté | P / R / F1 v10 | Refus v10 |
| --- | --- | --- | --- | --- | --- |
| Lac-des-Seize-Îles | oui | 1,000 / 0,250 / 0,400 | non | N-A / N-A / N-A | `entity_citation_excerpt_too_long` |
| Saint-Étienne-de-Bolton | oui | 0,800 / 0,235 / 0,364 | non | N-A / N-A / N-A | `entity_citation_excerpt_too_long` |
| Valcourt | oui | 1,000 / 0,833 / 0,909 | oui | 1,000 / 0,833 / 0,909 | aucun |
| Saint-Barthélemy | non | N-A / N-A / N-A | non | N-A / N-A / N-A | `entity_citation_excerpt_too_long` |
| Waterloo | non | N-A / N-A / N-A | non | N-A / N-A / N-A | `ungrounded_pdf_excerpt` |

| PDF | Latence v9 → v10 | Tokens entrée / sortie v9 → v10 |
| --- | ---: | ---: |
| Lac-des-Seize-Îles | 13 844 → 12 807 ms | 6 811 / 4 920 → 7 050 / 4 131 |
| Saint-Étienne-de-Bolton | 25 959 → 38 426 ms | 19 346 / 9 488 → 19 585 / 9 846 |
| Valcourt | 25 533 → 19 074 ms | 7 263 / 9 449 → 7 502 / 6 803 |
| Saint-Barthélemy | 47 135 → 41 647 ms | 14 493 / 14 000 → 14 732 / 12 807 |
| Waterloo | 41 042 → 58 683 ms | 19 017 / 12 218 → 19 256 / 17 059 |

## Déplacement des refus

- Saint-Barthélemy ne présente plus `missing_evidence_ref`. Sa sortie v10 porte
  une liste non vide sur 13/13 arêtes. Le refus se déplace vers
  `entity_citation_excerpt_too_long` : un extrait dépasse la limite produit de
  200 points de code Unicode.
- Waterloo conserve `ungrounded_pdf_excerpt`. Malgré la consigne contrastive,
  les deux extraits de décision écrivent encore `Yves-Malouin` là où le texte
  PDF extrait porte `YvesMalouin`; la classe et la cause v9 persistent.
- Lac-des-Seize-Îles et Saint-Étienne, acceptés en v9, sont désormais refusés
  par `entity_citation_excerpt_too_long`. Cette classe nouvelle touche donc
  trois PDF et réduit l'acceptation globale.
- Aucun reçu v10 ne signale `unknown_status`. Les sorties utilisent uniquement
  `attached`, `candidate` ou `validated`, tous admis par le validateur produit.

Le requalificateur hors ligne a été aligné sur la limite live de 200 points de
code. Il reproduit les cinq décisions d'acceptation sans modifier les sorties
brutes; les reçus v2 et le scoreur gelé concordent.

## Agrégats v10

- Latence campagne : 170 637 ms cumulés, moyenne 34 127,4 ms, maximum observé
  58 683 ms.
- Usage campagne : 68 125 tokens d'entrée, 50 646 de sortie, 118 771 au total.
- JSON : brut 0/5, valide après retrait du fence 5/5, extraction 5/5, accepté
  1/5.
- Sortie acceptée : TP=5, FP=0, FN=1; P=1,000, R=0,833, F1 macro=0,909;
  21/21 citations ont une identité, une page et un extrait valides.
- Sonnet : `N-A`; la clé Anthropic est absente de l'environnement contrôlé.

Le scoreur reste inchangé : seules les unités issues des nœuds `Signal` et
`DesignationEvent` comptent. Les nœuds `Bylaw` sont hors du numérateur; cette
limite est documentée mais non modifiée dans cette campagne.

## Gel et empreintes

- Commit produit v6 : `50d91e0e12a0d990a5ba23cb1f01104d01bcbb78`.
- Module profil : `4b477708e5fa3c068c0070f2cf7dc443cd8aae354947d704e84b22f9a05c1a05`.
- Module corpus inchangé : `461ed2c1d5da3892d5333d08d5910f57ee1516002fc41711f7c1c8b26570b903`.

| PDF | SHA schéma | SHA prompt |
| --- | --- | --- |
| Lac-des-Seize-Îles | `05969411cc8a37a20c159cdc2a03808d9028a3366f6387bc73b9a917398f3b79` | `582afe960c16570157c1263f9bc0a8aedd9975ab6a443c2612169c202eb9253d` |
| Saint-Étienne-de-Bolton | `d9952b6fa620af3992f57e54fa32781fe2ad3cd05e87adcae17fdbcb41152de4` | `87dc9bed2cc323edb5e8ef6df6227acc3e892077e5fc7156d24e5e133405b0f2` |
| Valcourt | `305c8ad9f435d83546ad525f2b1919426ea0c1e57c608325d61cb127d79124d6` | `e5684b8e6b92c4e123c42ad82ecdec7acf07a300d7617764859301aa3434a0e0` |
| Saint-Barthélemy | `a762cf7a8e92919df83b40930441f25e2c48e1066824cab4b6d222a608d14099` | `4c15f8e0e341ee0bb7780cb1cc2f06ab78d4714006d93a18e6414173782c178c` |
| Waterloo | `d78fef23e08600d6e774df6741bbdca687fe1dee5539d3042d74e753d585e286` | `7c9ea3df8d2615b44dfca1c524f7a14cec1b16a6c20e7bda999456ecd8895842` |

Le gel v10 conserve le manifeste et l'oracle v9, hors le champ de campagne, et
ne change que le commit profil ainsi que les empreintes de prompt et de schéma.
Gates : v10 21/21, cinq reçus v2 requalifiés hors ligne et score 5/5 cas.
Aucun acte produit ni merge n'a été effectué.
