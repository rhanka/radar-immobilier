# Livraison de l’étape 0

Lire `PREREG.md`. Le plan de branche suit les écarts encore ouverts.
`freeze.json` lie le protocole, les prompts et les manifestes par SHA-256.

Contrôle local, sans réseau ni appel de modèle :

```sh
rtk make -f tools/classif/1passe/step0.mk check ENV=test-classif-step0
```

Le contrôle utilise le dossier privé existant de cette machine.
Il ne déchiffre pas l’aveugle et n’affiche aucun acte.
`prepare` refuse un sceau existant. Ne pas le relancer sur cette étude.

Les manifestes exposent les paramètres de l’adaptateur `callSeat(route, prompt)`.
Les arguments complets des transports figurent dans `routes.json`.
`annotation.json` fixe les deux lectures indépendantes et la phase Argon séparée.
`singlepass.json` fixe deux itérations de deux candidats au plus.
Les prompts sont les fichiers voisins, suivis du pack C figé et du texte intégral du PV.
Le dispatcher du conducteur doit appliquer les plafonds et les gardes de `PREREG.md`.
Les anciens runners L2 et L4 ne consomment pas ces nouveaux manifestes.
Ne pas les lancer avec leurs valeurs par défaut : ils utiliseraient un autre protocole.
Le dispatcher B+C est désormais `annotate.mjs`, via `ops.mk annotate`.
Il applique huit appels par bras, les pauses de quota et le scellement immédiat.

Avant toute annotation future, le gardien doit :

1. Vérifier les textes intégraux locaux contre le manifeste v101b. Aucun texte ne doit être tronqué.
2. Vérifier le pack contre les trois empreintes d’`annotation.json`.
3. Réserver les comptes et le budget. Traiter le refus agy/Gemini avec le responsable du compte.
4. Donner aux annotateurs les seuls textes et le pack, sans oracle, classes ou avis antérieurs.
5. Garder les lectures aveugles dans le rôle `test-executor`, avec le journal privé.

Avant la passe unique, il faut sceller les labels C,
geler les finalistes et leurs prompts et vérifier les garde-fous du dispatcher.
Les contrôles de texte et de quota ne font aucun appel de modèle.
Le plan actif est `plan/1PASSE-BRANCH_feat-classif-1passe-bc.md`.

Le sceau se trouve hors Git :
`/home/antoinefa/.local/share/radar-classif/1passe-bc/blind/blind.sealed`.
La garde de clé est dans le sous-dossier privé `custody` du même espace.
Le gardien doit transmettre la clé au seul exécuteur, par variable d’environnement.
Le dossier privé ne constitue pas une séparation de comptes système.
Le corpus B reste publiquement accessible dans l’historique : ce n’est pas un corpus inédit.

La PR vers main inclut aussi l’historique non fusionné de la branche pilote.
Les nouveaux changements de cette lane sont limités à `1passe/` et au plan associé.
La PR reste draft. Aucune fusion n’est autorisée.
