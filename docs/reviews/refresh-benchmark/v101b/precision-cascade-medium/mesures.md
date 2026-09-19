# CP (astra-medium → vérification gemini-3.8 low, cascade de précision) — mesures (référence oracle v3, stricte)

Documents filtrés : 99/100. Actes jugés : 912 ; retirés : 229. Nature de l'acte retiré, au regard de la référence : faux (retrait justifié) 225 ; juste (retrait erroné) 4 ; non résolu 0.
Coût en rappel : 4 acte(s) juste(s) retiré(s) ; unités de la référence perdues (VP avant − après) : 1, soit -0.1 points de rappel (un acte juste retiré ne coûte rien si un autre acte gardé couvre la même unité) ; gain en précision : +11.3 points ; F1 : +6.9 points (après − avant).
Contrôles : identifiants inconnus ignorés 0 ; actes gardés faute de décision valide 0 ; « soutenu » avec extrait non retrouvé 7.

| | P | R | F1 | VP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| astra-medium seul | 0.370 | 0.533 | 0.437 | 359 | 611 | 315 |
| après filtre gemini-low | 0.483 | 0.531 | 0.506 | 358 | 383 | 316 |

Coût de la passe : 99 appels, 1.22 USD d'équivalent API (tarif 2026-09-16), latence P50 2.7 s, P95 6.8 s.
Coût cumulé du bras CP (équivalent API) : astra-medium 46.43 USD + passe gemini-low 1.22 USD = 47.65 USD sur 100 documents.
Coût cumulé en siège (coût API × facteur du fournisseur) : astra-medium 46.43 × facteur Codex 0.044235 = 2.0538 USD + passe 1.2223 × facteur Google 0.037931 = 0.0464 USD ; total 2.1002 USD pour le passage de 100 documents.
Jetons cumulés : astra-medium 2 132 053 + passe 1 305 290 = 3 437 343.
Latence par document (somme astra-medium + gemini-low, par document) : P50 193.4 s, P95 326.1 s (astra-medium seul : P50 191.5 s, P95 323.2 s) ; débit 18.5 documents/heure par fil d'exécution (×4 en parallèle).
Documents refusés par astra-medium (aucune sortie à filtrer) : waterville-2026-04-07 — notés comme le scoreur, toutes leurs unités en manqué, avant comme après le filtre : c'est une différence de couverture, pas de qualité du filtre.
Limite à déclarer : la consigne du filtre porte la liste d'exclusions du corrigé (nominations, comptes, contrats de services, loisirs, voirie sans développement, dépôts de correspondance) ; la consigne d'extraction des bras (contrat immo-pv-extraction-v9) ne la porte pas. Une part du gain de précision vient de cet alignement sur les règles du corrigé, pas du seul fait de relire.
Les quatre variantes (stricte, large, tolérante, souple) figurent dans `oracle-v3/tableau-f1-100.md`, ligne « CP ».

