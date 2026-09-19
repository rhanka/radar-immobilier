# Référence oracle v3 — unanimité et arbitrage

- Documents complets : 100/100
- Unités vérifiées : 770
- Unanimes à la vérification : 641 retenues, 29 écartées
- Fusionnées par recouvrement d'intervalles (≥ 12 caractères normalisés, même objet exact, même étape, même page) au lieu d'être arbitrées : 7 (verdict d'arbitrage concordant 7, différent 0). Diagnostic ROUGE-L ≥ 0.5, qui ne décide rien : 7 fusions auraient eu lieu ; 0 par les intervalles seuls, 0 par ROUGE-L seul.
- Arbitrées et résolues : 55 (31 retenues, 24 écartées)
- Non résolues (owner, `unresolved.json`) : 47
- En attente : 0
- Unités de la référence : 674
- Écarts avec l'humain : 10 arbitrés, 0 sans explication

Paires de versions d'une même unité (même objet, même étape) : 15 ; rapprochées par les intervalles 12, par ROUGE-L 13 ; intersection min 0 car. ; ROUGE-L 0.29–0.94.
Paires d'unités distinctes (même objet, même étape, même page) : 8 ; rapprochées à tort par les intervalles 0, par ROUGE-L 7 ; ROUGE-L max 0.94.
Limite assumée (avis Astra) : deux passages éloignés qui prouvent le même acte ne sont pas rapprochés par les intervalles ; ils restent en arbitrage.
  - non rapprochée : saint-tite-des-caps-2026-02-02 u05, pages 2/1, intersection 0 car., ROUGE-L 0.32
  - non rapprochée : saint-tite-des-caps-2026-02-02 u05, pages 1/2, intersection 0 car., ROUGE-L 0.29
  - non rapprochée : contrecoeur-2026-04-14 u01, pages 4/4, intersection 0 car., ROUGE-L 0.58
Liste nominative des paires, avec leurs deux citations : `soft-diagnostics.json`.

**Pourquoi les intervalles et pas ROUGE-L.** Sur les 8 paires d'unités distinctes qui partagent objet, étape et page, les intervalles n'en rapprochent aucune, ROUGE-L en rapprocherait 7, jusqu'à 0.94. Sur le corrigé, les deux méthodes fusionnent les mêmes 7 unités (0 par les intervalles seuls, 0 par ROUGE-L seul) : le choix ne change pas la référence, il change le risque. Dans la notation des bras, les correspondances apportées par ROUGE-L seul sont comptées dans `tableau-f1-100.md` ; l'avis Fable les décrit comme majoritairement fausses (numéros voisins).
Les deux avis contradicteurs recommandent les positions dans le texte plutôt que ROUGE-L, et jugent qu'une calibration de seuil sur les 36 unités humaines ne vaut pas validation.

## Annexes — avis contradicteurs, verbatim

- `avis/ROUGE_L_AVIS_ASTRA.md` — texte abrégé : la génération s'est arrêtée avant la fin et le conducteur a retiré des liens vers des chemins absolus de la machine ; raisonnement et recommandation présents, fin du paragraphe proposé tronquée.
- `avis/ROUGE_L_AVIS_FABLE.md` — texte complet.

| Nature de l'écart | Verdict | Nombre |
|---|---|---:|
| unité humaine absente du v3 | l'humain avait raison | 1 |
| unité v3 absente de l'humain | non résolu (owner) | 3 |
| non unanime | non résolu (owner) | 1 |
| unité humaine absente du v3 | non résolu (owner) | 2 |
| unité humaine absente du v3 | le v3 avait raison | 1 |
| unité v3 absente de l'humain | le v3 avait raison | 2 |

