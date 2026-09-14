# Export versionné des cinq scènes d'architecture

Trois formats par scène, tous produits par la **même** chaîne que le dossier
interactif et les annexes du rapport mensuel — aucune scène, aucun libellé,
aucun texte de rapport n'est modifié ici : c'est un export, pas une source.

| Fichier | Ce que c'est | À lire pour |
|---|---|---|
| `<scene>.graph.json` | le **graphe formel** : conteneurs, cartes et arêtes, avec tous les champs métier et les positions Dagre | **lecture par une IA / un programme** : ids explicites, hiérarchie `parentId`, libellés d'arête, aucun rendu à interpréter |
| `<scene>.mmd` | le bloc Mermaid `flowchart LR` **exact** extrait de `docs/architecture.md` | **humain et diff** : la topologie en dix lignes de texte, comparable d'une version à l'autre |
| `<scene>.png` | la capture Chromium **à échelle 1**, pleine résolution native, scène entière | **visuel** : lecture à l'écran, zoom, illustration |

Les cinq scènes : `hosting-july-2026`, `hosting-august-20260810`,
`hosting-today-20260913`, `pipeline-before-20260810`, `pipeline-after-20260913`.

## Y a-t-il un format formel derrière SvelteFlow ?

**Oui, et il est en amont de SvelteFlow, pas dedans.** SvelteFlow ne définit pas
de format d'échange : il consomme des tableaux `nodes` / `edges` JavaScript
(`id`, `position`, `data`, `parentId`) où tout le sens métier est libre dans
`data`. Le format formel de cette chaîne est donc **le graphe produit avant le
rendu**, et c'est ce que `*.graph.json` publie.

La chaîne, mesurée :

1. **Source canonique** — `docs/architecture.md`, un bloc ```` ```mermaid ````
   `flowchart LR` par scène, sous un titre de niveau 3 portant l'identifiant.
2. **Analyse** — `docs/architecture/focus/parse-mermaid.mjs:11` (`parseMermaid`)
   produit `{ nodes, groups, edges }` : identifiants, libellés normalisés NFC,
   `parent` (imbrication des `subgraph`), `dashed` / `both`, numéro de ligne
   Mermaid. Le sous-ensemble accepté est borné : toute syntaxe inconnue échoue.
   `extractCanonicalDiagrams` (`parse-mermaid.mjs:49`) impose les cinq scènes,
   dans l'ordre.
3. **Décoration métier** — `scene-metadata.js:422` (`decorateGraph`) attache à
   chaque nœud, conteneur et arête : `card`, `kind`, `code`, `role`, `name`,
   `detail`, `icon`, `repo[]`, `evidenceClass`, `runtimeState`. `metadataFor()`
   refuse tout écart, dans les deux sens, entre le Mermaid et les métadonnées.
4. **Projection canonique + empreinte** — `build-map.mjs:11` produit une
   projection triée et son `sceneHash` SHA-256, puis écrit
   `docs/architecture/focus/.generated/data.json` (`build-map.mjs:44`).
5. **Géométrie** — `scenes.js:67` (`sceneFor`) place le tout par Dagre récursif
   (`rankdir: LR`, `nodesep: 24`, `ranksep: 72`), chaque `subgraph` restant une
   vraie boîte parente, puis route les arêtes et pose leurs libellés.
6. **Rendu** — SvelteFlow consomme le résultat de l'étape 5. Dernière étape,
   purement visuelle.

Le JSON le plus lisible par une IA est **`<scene>.graph.json`** (schéma
`immo-archi-scene-graph/v1`), produit par
`docs/architecture/focus/export-scenes.mjs:41` (`formalGraph`) à partir des
étapes 2–5 : il réunit ce que `data.json` sépare (métadonnées métier) et ce que
seul le rendu connaissait jusqu'ici (positions Dagre). Il contient, par scène :

- `sceneId`, `title`, `pair`, `date`, `sceneHash`, et `source` (fichier et bloc
  d'origine) ;
- `layout` : moteur, `rankdir`, `nodesep`, `ranksep`, gabarit de carte, canevas ;
- `counts` : conteneurs, cartes, arêtes ;
- `containers[]` et `nodes[]`, triés par `id` : `parentId`, `label`, `kind`,
  `repo[]`, `evidenceClass`, `runtimeState`, `mermaidLine`, `position` (relative
  au parent), `absolutePosition`, `size` ; et pour les cartes `code`, `role`,
  `name`, `detail`, `icon`, `card`, `store` ;
- `edges[]`, triées par `id` : `source`, `target`, `label`, `dashed`,
  `bidirectional`, `evidenceClass`, `runtimeState`, `mermaidLine`,
  `labelPosition`.

Ce qui n'y figure **pas**, volontairement : la polyligne de routage de chaque
arête (`routedPoints`), qui est un détail de tracé recalculable par `sceneFor()`
et qui rendrait le fichier illisible en revue.

`data.json` (étape 4) reste disponible mais n'est pas versionné : il pèse
352 Kio (360 590 octets), mélange les cinq scènes, tout le corpus documentaire du dossier et les
sources du moteur de rendu, et **ne porte aucune position**.

## Régénération

```bash
# 1. le Chromium de contrôle, à lancer en premier (CDP 9238)
make -f docs/architecture/focus/Makefile chrome-run ENV=<env> &

# 2. l'export : Mermaid → graphe → build Vite → captures natives
make -f docs/architecture/focus/Makefile export-scenes ENV=<env>
```

`ENV` est **le dernier argument de make**. La cible n'écrit ni rapport ni PDF :
elle ne produit que les quinze fichiers de ce dossier, plus
`docs/architecture/focus/.generated/export-scenes.json` (résumé mesuré, non
versionné). Elle refuse de publier si l'échelle de capture n'est pas 1, si
l'inventaire capturé ne correspond pas au graphe, si le PNG ne fait pas la taille
demandée, ou si un fichier étranger traîne dans ce dossier.

**Reproductibilité mesurée** : deux exécutions consécutives redonnent les quinze
fichiers **au bit près** (`sha256sum -c`, 15/15 OK).

## Empreintes SHA-256

| Fichier | Taille | Dimensions | SHA-256 |
|---|---|---|---|
| `hosting-july-2026.png` | 551,6 Kio | 4360 × 1995 px | `f7ee5757dfb3c8b42fa55bca883931eb104fc445a7ad002f55986db7f477fc89` |
| `hosting-july-2026.mmd` | 1 811 o | — | `a9576dd8f25343f2ae62122fb8d71fc817e5a92958443bfff2ef7714139f9599` |
| `hosting-july-2026.graph.json` | 24 970 o | 21 cartes · 2 conteneurs · 25 arêtes | `9f1e1cfaa879d3b7c85830dbc581e2d799d5473124e3e93f3bbe9ef0939c0f0d` |
| `hosting-august-20260810.png` | 535,0 Kio | 4360 × 1995 px | `6ee2d53b0f960be08abf118600847c98111ba79871fa05f40ab28fcb2ea21fef` |
| `hosting-august-20260810.mmd` | 1 800 o | — | `3a25b5fc83f898fdb2ad7134ca1c6e8b92345150e590ed28f7a6e95f60a686a0` |
| `hosting-august-20260810.graph.json` | 24 958 o | 21 cartes · 2 conteneurs · 25 arêtes | `8ea7cca851b4901cf6462ce1af67353e735acd90af80945ccbf64c91b8d2dea0` |
| `hosting-today-20260913.png` | 749,7 Kio | 4360 × 2107 px | `fe2975345094b7aecdfbbd08f95cbda588a777de90187d56888eeacddf5fa035` |
| `hosting-today-20260913.mmd` | 2 578 o | — | `1d7e89597462ebcd56e8be0b6cf829a189077c7de7d10aa529dab9295c10e2da` |
| `hosting-today-20260913.graph.json` | 34 455 o | 30 cartes · 3 conteneurs · 33 arêtes | `49ccb6f8549907d5e9fb0ea15d6e029e8cefd11b01623af6390dab66559b6c72` |
| `pipeline-before-20260810.png` | 419,8 Kio | 5472 × 1293 px | `472db3ff80df04653672a73c13ce32bf0a1b42377ce35e0f1d0421f29d2c0a4f` |
| `pipeline-before-20260810.mmd` | 1 554 o | — | `c9f80196022d0e97c557dff5b98088dfe07d2c4f81c30a53ed6778a670e8f3aa` |
| `pipeline-before-20260810.graph.json` | 21 320 o | 18 cartes · 3 conteneurs · 19 arêtes | `0c27b2ac1d16ce080adb5218de7c20f74533d3ec2030da2275371cab6897dcbc` |
| `pipeline-after-20260913.png` | 466,5 Kio | 4940 × 1247 px | `2194284b011540fd1666c2ca53c0e09441b083332eb6560db2587cd0f38fbe13` |
| `pipeline-after-20260913.mmd` | 1 694 o | — | `0b8e1a3fa247ef2d28dd28692b0b837f4e62dff3295e1d71fdbf311d11b02edd` |
| `pipeline-after-20260913.graph.json` | 24 117 o | 22 cartes · 3 conteneurs · 20 arêtes | `72f7a78fec43014cd128d29d76c37e434a3ab59b607e45255e86eb38599c257b` |

Total des cinq PNG : **2 787 906 octets = 2,66 Mio**.

Ce `README.md` n'est pas régénéré par la cible : après une nouvelle exécution,
reprendre les empreintes dans `docs/architecture/focus/.generated/export-scenes.json`.
