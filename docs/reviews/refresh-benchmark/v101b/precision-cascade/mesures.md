# CP-low (astra-low → vérification gemini-3.8 low ; première cascade, hors rapport) — mesures (référence oracle v3, stricte)

Documents filtrés : 100/100. Actes jugés : 888 ; retirés : 198. Nature de l'acte retiré, au regard de la référence : faux (retrait justifié) 197 ; juste (retrait erroné) 1 ; non résolu 0.
Coût en rappel : 1 acte(s) juste(s) retiré(s) ; unités de la référence perdues (VP avant − après) : 0, soit +0.0 points de rappel (un acte juste retiré ne coûte rien si un autre acte gardé couvre la même unité) ; gain en précision : +10.7 points ; F1 : +6.1 points (après − avant).
Contrôles : identifiants inconnus ignorés 0 ; actes gardés faute de décision valide 0 ; « soutenu » avec extrait non retrouvé 11.

| | P | R | F1 | VP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| astra-low seul | 0.372 | 0.490 | 0.423 | 330 | 558 | 344 |
| après filtre gemini-low | 0.478 | 0.490 | 0.484 | 330 | 360 | 344 |

Coût de la passe : 100 appels, 1.19 USD d'équivalent API (tarif 2026-09-16), latence P50 2.5 s, P95 5.7 s.
Coût cumulé du bras CP-low (équivalent API) : astra-low 40.72 USD + passe gemini-low 1.19 USD = 41.91 USD sur 100 documents.
Coût cumulé en siège (coût API × facteur du fournisseur) : astra-low 40.72 × facteur Codex 0.044235 = 1.8013 USD + passe 1.1946 × facteur Google 0.037931 = 0.0453 USD ; total 1.8466 USD pour le passage de 100 documents.
Jetons cumulés : astra-low 2 023 478 + passe 1 282 754 = 3 306 232.
Latence par document (somme astra-low + gemini-low, par document) : P50 153.9 s, P95 328.8 s (astra-low seul : P50 150.6 s, P95 323.2 s) ; débit 22.6 documents/heure par fil d'exécution (×4 en parallèle).
Limite à déclarer : la consigne du filtre porte la liste d'exclusions du corrigé (nominations, comptes, contrats de services, loisirs, voirie sans développement, dépôts de correspondance) ; la consigne d'extraction des bras (contrat immo-pv-extraction-v9) ne la porte pas. Une part du gain de précision vient de cet alignement sur les règles du corrigé, pas du seul fait de relire.
Les quatre variantes (stricte, large, tolérante, souple) figurent dans `oracle-v3/tableau-f1-100.md`, ligne « CP-low ».

