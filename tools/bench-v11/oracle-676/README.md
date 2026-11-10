# Oracle 676 — reconstruction bench-v11 (depuis 674 + correctif #725)

Source gelée : `origin/feat/t1-model-benchmark-real` dd0561f6,
`docs/reviews/refresh-benchmark/v101b/oracle-v3/consensus.json` (674 unités)
+ `unresolved.json` (47 non résolus).

## Correctif 1 appliqué (+2 unités, −4 non résolus)

Fusion des doubles représentations de deux actes de Saint-Barthélemy
unanimement reconnus (commentaire #725) :

- `saint-barthelemy-2026-09-08#u01` ← a02 (humaine S738, ancrée sommaire p.4)
  + a05 (v3, ancrée titre p.3) : adoption règlement 738-26, objet `738-26`.
- `saint-barthelemy-2026-09-08#u03` ← a03 (humaine S739P, p.5)
  + a06 (v3, p.4) : premier projet 739-26, objet `739-26`.

Objet réglementaire explicite retenu ; les deux emplacements conservés
(site primaire + `alternate_sites`, règle R3 du scoreur). Les identifiants
u01/u03 reprennent ceux de l'arbitrage pour ces représentations.
a01 (aqueduc, désaccord réel) reste non résolu.

Résultat : 676 unités, 43 non résolus. `unitCount`, `counts.unresolved`
et le statut documentaire de Saint-Barthélemy (6→8) mis à jour ; le reste
du gel est inchangé (aucune réécriture).

## Correctif 2 NON appliqué (85 citations à réancrer)

Le lot de convergence à trois modèles (nouvelles ancres contenant formule
+ identifiant) n'a aucune trace dans le dépôt (branche bench figée au
19/09, aucune autre branche ne le porte) et les nouvelles ancres ne sont
publiées nulle part. Reconstruction exacte impossible.
Effet borné par #725 : 1 à 2 appariements déplacés par bras, gain
mécaniquement positif ou nul (l'emplacement actuel serait conservé en site
alternatif), classement inchangé. Les scores 676 ci-dessous sont donc un
minorant de l'oracle 676+réancré.
