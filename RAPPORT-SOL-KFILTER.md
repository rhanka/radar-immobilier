# Retrait du filtre Python — #851 / #810

Le reconcile préprod utilise maintenant `kfilter.sh` et `kfilter.jq`.
`deploy/ci/kfilter.py` est supprimé ; le garde CI refuse les fichiers `.py`
sous `deploy/`, y compris les sous-répertoires et liens symboliques.

L’équivalence est vérifiée par comparaison des octets avec des sorties figées,
puis avec un sélecteur awk indépendant sur le véritable rendu préprod.
Le filtre conserve les documents entiers, leur ordre, leurs champs, les blocs
littéraux, les tabulations et les espaces. Comme l’ancien lecteur texte,
il normalise CRLF/CR vers LF et retire seulement les sauts de ligne aux limites.
Les modes kind, nom exact, préfixe et noms seuls sont couverts, ainsi que leurs
combinaisons, les résultats vides et les champs absents. Aucun sérialiseur YAML.

Les objets appliqués restent les ConfigMaps `radar-ui-nginx*`, `radar-api` et
`immo-mcp-config` conditionnellement à la présence du Deployment MCP, les
Deployments `radar-api` / `radar-ui` et le CronJob `radar-consistency-snapshot`.
L’ordre des applications, les options SSA et la rotation MCP sont conservés.
Le workflow CD appelant reste inchangé ; le workflow qualité lance les nouveaux
tests et le garde. README et tests MCP sont actualisés ; les interpréteurs Python
y sont remplacés par des doublures qui échouent à chaque invocation.

Les résultats ci-dessous décrivent la livraison initiale `86a6697e` ; les
corrections et résultats de la PR #928 figurent dans la dernière section.

| Vérification | Résultat initial |
|---|---|
| Filtre : fixtures, 4 variantes de fins de ligne, rendu, erreurs CLI | PASSED — 60 |
| Reconcile MCP hermétique, kubectl simulé | PASSED — 11 |
| Isolation auth préprod | PASSED — 25 |
| Garde anti-Python : acceptation, fichier imbriqué, lien | PASSED — 3 |
| Garde sur le vrai répertoire deploy | PASSED |
| Syntaxe Bash des 6 scripts concernés | PASSED |
| Rendu kustomize préprod + isolation auth du fichier rendu | PASSED |
| Harness C1 / C2 | PASSED |
| Harness static | PASSED — 0 contrôle configuré ; ne remplace pas les tests |
| Échecs finaux | FAILED — 0 |
| CI distante, tests applicatifs/E2E | SKIPPED — aucun push, périmètre shell |
| Consensus harness | SKIPPED — sélection impossible, catalogue absent |

Commande de validation : `rtk make -f tmp/kfilter-851.mk test guard syntax render ENV=test-kfilter-851`.
Le Makefile temporaire évite l’inclusion automatique de `.env`. Aucun `.env` lu,
aucun exécutable Python lancé, aucune pile Docker démarrée, aucun push effectué.
Un échec intermédiaire du premier filtre jq a été reproduit et corrigé avant
le premier commit ; les comparaisons finales passent intégralement.

La [règle de revue harness](/home/antoinefa/.codex/skills/harness-review/SKILL.md)
impose « require ≥2 » modèles admissibles distincts. Aucun catalogue actif
n’étant configuré, le dossier `tmp/kfilter-review.md` porte `selection-failed` ;
aucun pair lancé et aucun verdict de consensus déclaré.

Base : `7510a0d1f3e89891f1f9dc58c786b18431c78037`.
SHA final du code validé : `a3a5de14b8f3c337fb13019c9fd8d0ffcfbd979e`.
Commits du code : `422acecf`, `2b78ff82`, `80eef241`, `5639b88d`, `a3a5de14`.
Chaque commit compte au plus 150 lignes modifiées, avec sujet Conventional Commit
anglais de 72 caractères maximum, sans corps ni trailer.

Lors de la livraison initiale, le `.git` partagé étant en lecture seule, les commits ont été créés dans
`tmp/kfilter-rescue.git`, branche `chore/851-retire-kfilter`. Le HEAD partagé
est resté à la base ; les modifications étaient également présentes dans le worktree.
Livraison initiale : `tmp/kfilter-851.bundle` ; prérequis : la base ci-dessus.
Son empreinte est dans `tmp/kfilter-851.bundle.sha256`. L’audit
`tmp/kfilter-851-bundle-audit.txt` donne le SHA final incluant ce rapport,
vérifie le bundle, le rejoue dans un dépôt distinct dépendant uniquement de la
base, contrôle sa connectivité, son arbre, son périmètre et chaque commit.

## Corrections revues astra

Les revues `astra-928-a.md` et `astra-928-b.md`, sous
`.lanes/conductor/tmp/revues/`, ont été lues intégralement. Leurs deux bloquants
et leur remarque commune sur le LF final sont corrigés au-dessus de
`86a6697e0347e576bde12614ba9df60e02c64c98`, sans réécrire les six commits initiaux.

- **UTF-8** : corruption reproduite avec jq 1.8.1 à 4 094 octets ASCII avant `é`.
  La lecture utilise désormais `--rawfile`. La validation native par
  `iconv -f UTF-8 -t UTF-16LE` précède toute sortie : une conversion UTF-8
  vers UTF-8 acceptait expérimentalement des valeurs hors Unicode.
  Onze fixtures longues couvrent les caractères de 2/3/4 octets et plusieurs
  frontières, ainsi que U+FFFD valide et les limites scalaires Unicode.
  Dix encodages invalides (troncatures, octets isolés, surrogates, formes trop
  longues, valeurs hors plage, séquences de 5/6 octets) échouent dans trois modes,
  avec stdout vide, même après un document sélectionné et sans correspondance.
- **Garde** : le contournement par répertoire lié et la casse `.PY` ont été
  reproduits avant correction. `find -L` parcourt les répertoires liés ; les
  noms exposés et cibles finales sont vérifiés, y compris les chaînes de liens
  sans extension. Les dix extensions documentées sont comparées sans tenir
  compte de la casse. Boucles, liens non résolus et erreurs de parcours échouent.
  Les témoins acceptent les liens bénins, la documentation `README.py.md` et les
  répertoires ordinaires `cache.py` / `cache.PYW`.
- **LF final** : l'ancien témoin terminait par l'octet 10 ; il est renommé
  `no-trailing-blank-line`. La nouvelle entrée termine exactement après
  `name: at-eof`, sans séparateur ni LF. Deux préconditions vérifient sa dernière
  ligne et son dernier octet avant les quatre comparaisons de sortie.

| Vérification après correction | Résultat |
|---|---|
| Filtre, fixtures, rendu et erreurs | PASSED — 106 |
| Garde anti-Python et témoins d'acceptation | PASSED — 23 |
| Reconcile MCP hermétique | PASSED — 11 |
| Isolation auth préprod | PASSED — 25 |
| Total des assertions shell | PASSED — 165 ; FAILED — 0 |
| Syntaxe Bash des six scripts, garde réel, rendu kustomize préprod | PASSED |
| CI distante et tests applicatifs/E2E | SKIPPED — aucun push, périmètre shell |

Commande : `rtk make -f tmp/kfilter-851.mk test guard syntax render ENV=test-kfilter-851`.
Les objets, champs et options du reconcile, ainsi que les manifestes, sont inchangés.
Aucun `.env` lu, exécutable Python lancé, conteneur démarré ou push effectué.
Le README précise les dépendances natives déjà présentes et les extensions retenues.

SHA du code corrigé et validé : `b75f23ad6d39e81108d02667b00fc35244a653a7`.
Commits correctifs : `1b863f4b` (UTF-8), `11436903` (garde), `b75f23ad` (LF).
Le commit documentaire suivant contient cette section et le README.
Le HEAD partagé demeure à `86a6697e` ; les nouveaux commits sont dans
`tmp/kfilter-rescue.git`, branche `chore/851-retire-kfilter`.
Nouveau bundle : `tmp/kfilter-928-astra.bundle`, prérequis `86a6697e`.
Empreinte : `tmp/kfilter-928-astra.bundle.sha256`.
Audit : `tmp/kfilter-928-astra-bundle-audit.txt`, avec SHA final incluant le rapport,
rejeu isolé, connectivité, identité de l'arbre, périmètre et limites de chaque
commit (150 lignes, sujet Conventional de 72 caractères maximum, corps et trailer absents).
