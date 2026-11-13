# Reproduction et relais aveugle

Worktree : `tmp/classif-1passe-csets`. Branche : `feat/classif-1passe-csets`.
Le 13 novembre, l’owner autorise le chargement du `.env` par make.
La cible utilise `node --env-file`. Elle n’affiche ni le fichier ni la clé.
Le transport supprime la clé de l’environnement transmis au modèle.

V1 conserve le cache historique. V2 utilise son propre sous-répertoire privé.
Les prompts sont figés par SHA-256. Le mode par défaut est B seul.
Ne pas ouvrir les fichiers par unité. Ne publier que les agrégats.

V1 aveugle :

```sh
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/quota.mjs ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/run.mjs ARGS=blind CLASSIF_ROLE=test-executor ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/score.mjs ARGS=blind CLASSIF_ROLE=test-executor ENV=test-csets
```

V2 : exécuter la séquence pour `tuning`, puis pour `blind`.
Remplacer `<half>` par la valeur choisie.

```sh
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/quota.mjs CSETS_VERSION=v2 ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/run.mjs ARGS=<half> CSETS_VERSION=v2 CLASSIF_ROLE=test-executor ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/score.mjs ARGS=<half> CSETS_VERSION=v2 CLASSIF_ROLE=test-executor ENV=test-csets
```

Concurrence fixe : 10. Arrêt des nouveaux appels à 90 % du quota.
Les appels en cours se terminent. Une reprise conserve les caches identiques.
Ne pas relancer une réponse selon sa classe. Ne pas exécuter d’optimiseur.
La validation native du graphe concerne uniquement l’ancien mode A.
Le mode B valide la classe, le code et la justification de l’annotation.

Publication et vérification :

```sh
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/classification-report.mjs ENV=test-csets
make -f tools/classif/csets.mk csets-test ENV=test-csets
make -f tools/classif/classif.mk classif-check ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/verify.mjs ENV=test-csets
```

Le générateur historique `report.mjs` décrit l’ancienne étude A/B.
Le rapport courant est produit par `classification-report.mjs`.
L’acceptation exige 252 unités par nouvelle mesure, une matrice de somme 252,
aucun outil, les intervalles de Wilson et un verdict D4 à zéro manqué.
