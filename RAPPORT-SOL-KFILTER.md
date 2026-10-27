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

| Vérification | Résultat final |
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

Le `.git` partagé étant en lecture seule, les commits sont dans
`tmp/kfilter-rescue.git`, branche `chore/851-retire-kfilter`. Le HEAD partagé
reste à la base ; les modifications sont également présentes dans le worktree.
Livraison : `tmp/kfilter-851.bundle` ; prérequis : la base ci-dessus.
Son empreinte est dans `tmp/kfilter-851.bundle.sha256`. L’audit
`tmp/kfilter-851-bundle-audit.txt` donne le SHA final incluant ce rapport,
vérifie le bundle, le rejoue dans un dépôt distinct dépendant uniquement de la
base, contrôle sa connectivité, son arbre, son périmètre et chaque commit.
