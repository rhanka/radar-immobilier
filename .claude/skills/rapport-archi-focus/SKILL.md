---
name: rapport-archi-focus
description: Rebuild the Focus architecture scenes and the monthly report annex — single A' card template, Dagre LR layout, whole-scene A4 portrait annex with transition commentary, Chromium proofs
paths: "docs/architecture.md,docs/architecture/focus/**,docs/reports/**"
allowed-tools: Read Write Edit Bash Glob Grep
---

# Rapport archi Focus — kit de regénération

Chaîne reproductible qui produit, à partir d'une source Mermaid canonique :

1. le dossier interactif `docs/architecture/decision-focus.html` (SvelteFlow,
   hors ligne, zoom / pan / 1:1 / minimap) ;
2. l'annexe A4 **portrait** du rapport mensuel `rapport-mois-<debut>_<fin>.{html,pdf}` —
   annexe A (états d'hébergement) et annexe B (pipeline), une scène entière par page ;
3. les preuves mesurées (captures Chromium, `evidence-manifest-*.json`).

Provenance : baseline **codex-13-sept**
(`tmp/architecture-preprod-transition/docs/architecture/decision-focus.html`,
vue « Architecture AVANT », `asis-1`). Tout écart à cette baseline se documente,
jamais ne se subit.

## 1. Où sont les choses

| Rôle | Fichier |
|---|---|
| Source canonique des scènes (Mermaid `flowchart LR`) | `docs/architecture.md` |
| États, provenance et **contenu des cartes** | `docs/architecture/focus/scene-metadata.js` |
| Géométrie et placement (Dagre + routage) | `docs/architecture/focus/scenes.js` |
| Gabarit unique de carte (rendu) | `docs/architecture/focus/ServiceNode.svelte` |
| Gabarit de conteneur | `docs/architecture/focus/Subflow.svelte` |
| Icônes (pictogrammes locaux, jamais de logos) | `docs/architecture/focus/service-icons.js` + `ServiceIcon.svelte` |
| Extraction Mermaid vers graphe | `docs/architecture/focus/parse-mermaid.mjs`, `build-map.mjs` |
| Rendu du rapport + pages d'annexe pleine scène | `docs/architecture/focus/report-render.mjs` |
| PDF final (rapport seul) et manifeste | `docs/architecture/focus/report-finalize.mjs` |
| Contrôles Chromium | `docs/architecture/focus/browser-check.mjs` |
| Tests | `mapping.test.mjs`, `nested.test.mjs`, `provenance.test.mjs`, `choices.test.mjs` |

Une scène = un bloc de code `mermaid` placé sous un titre de niveau 3 portant
l'identifiant de scène, dans
`docs/architecture.md`. L'identifiant du bloc et la clé de `scene-metadata.js`
doivent coïncider : `metadataFor()` refuse tout nœud ou toute arête en trop ou
manquant, des deux côtés.

## 2. Le gabarit unique A' (contrat owner, v10)

Échelle 1, polices fixes. **Le code n'apparaît qu'une fois, ligne 1, et n'est
jamais répété dans le nom.** Aucune carte ne porte « Code + manifests ».
**Il n'y a plus qu'un gabarit** : les anciennes cartes C (bases, buckets,
routes, registres, navigateur…) sont des cartes A' comme les autres.

### A' (`card: 'A'`) — 460 × 200 px, 5 lignes de texte

| # | Ligne | Police | Contenu |
|---|---|---|---|
| 1 | code, **à droite de l'icône** | 22 px gris | `PP-SCRAPE`, `EDGE`, `WS-OPS`… |
| 2 | titre = rôle court, **à droite de l'icône**, gras | 32 px | « CronJob · collecte », « Base · préprod », « Bucket S3 · docs prod », « Navigateur » |
| — | espace sous le titre | — | **6 px** (plus la ligne vide de la v9) |
| 3 | nom | 24 px | nom Kubernetes / composant, ex. `radar-refresh-pv` |
| 4 | **un** détail métier | 24 px gris | CronJob : planning + étape · route · volume · moteur |
| — | séparateur | — | filet 1 px, marge 4 px |
| 5 | `repo:` | 24 px gras | `repo: radar-immobilier` |

**L'icône fait exactement la hauteur des deux premières lignes** : 22 × 1,3 +
32 × 1,3 = **70,19 px**, donc `ICON = 70` px, carrée, à gauche, centrée sur le
bloc code + titre. Les lignes 1 et 2 commencent à sa droite (x = 92 px depuis le
bord de la carte : 16 d'encart + 70 d'icône + 6 de gouttière) ; les lignes 3 à 5
occupent toute la largeur utile (x = 16 px).

### Plus aucune ligne de statut

`observé · actif`, `historique · actif`, `déclaré · dormant` : **supprimés
partout**, cartes et conteneurs. `evidenceClass` / `runtimeState` restent des
états fermés portés par les données (`data-evidence-class`, `data-runtime-state`,
projection canonique, tests) — ils ne sont simplement plus écrits sur le schéma.
Un état qui compte se dit **dans le détail** :

| Cas | Détail |
|---|---|
| refresh production | `dormant · gaté par PR #682` |
| Scaleway TEM | `transactionnel · seule exception` (rôle `Courriel · exception`, nom `Scaleway TEM`) |
| MinIO (juillet / 10 août) | `stockage objet interne · PVC` |

### Titre de rôle : la règle « deux par deux »

Au plus **deux segments** séparés par `·`, au plus **deux mots** par segment
(`roleIsShort()` dans `scene-metadata.js`). Passent : `Base · préprod`,
`Bucket S3 · docs prod`, `Route · production`, `Registre d'images`,
`Navigateur`, `Étape 1 · collecte`. Ne passent pas : un rôle vide, un rôle à
trois segments, un segment de trois mots.

### Conteneurs (`card: 'box'`)

Cluster, namespaces, poste opérateur : **titre + `repo:` uniquement**. Jamais de
ligne de détail, jamais de statut, jamais de code dans le titre, jamais de rôle.
`SUBFLOW_HEADER_SPACE = 96` couvre 32 (titre) + 4 + 24 (`repo:`) + padding.

### Règles vérifiées au build

`metadataFor()` refuse : un gabarit inconnu · un conteneur marqué `A` (et
l'inverse) · un conteneur porteur d'un rôle · un `code`, `role`, `name` ou
`detail` vide · un code contenu dans le nom · un rôle qui viole « deux par deux ».
`report-render.mjs` et `browser-check.mjs` refusent en plus, dans la page :
une ligne `data-text-role="status"` encore rendue · une icône dont la hauteur
s'écarte de plus d'1 px des deux premières lignes · une carte dont les lignes 3–5
ne partent pas de l'encart 16 px, ou dont la ligne 1 ne démarre pas après l'icône.

## 3. Largeurs : mesurer avant de figer

La largeur **460 px** n'est pas un choix esthétique, c'est le minimum mesuré qui
ne tronque rien :

- lignes 1–2 : 26 (bordures 8 + 2 et padding 2 × 8) + 70 (icône) + 6 (gouttière)
  + **356,4** (le plus large rôle gras 32 px, `Planification · absente`) = 458,4 ;
- lignes 3–5 : 26 + **355,7** (le plus large détail 24 px,
  `transactionnel · seule exception`) = 381,7.

Hauteur **200 px** = 70,19 (icône et les deux premières lignes) + 6 + 31,2 (nom)
+ 31,2 (détail) + 9 (filet et marges) + 31,2 (`repo:`) + 20 (padding et bordures)
= 198,8, arrondi à 200.

Avant de changer un libellé, mesurer dans le vrai document :

```js
// dans la page du dossier, via CDP Runtime.evaluate
const probe = document.createElement('span');
probe.style.cssText = 'position:absolute;white-space:nowrap;visibility:hidden;font-family:'
  + getComputedStyle(document.body).fontFamily;
document.body.appendChild(probe);
probe.style.fontSize = '24px'; probe.textContent = 'preprod.immo.sent-tech.ca';
probe.getBoundingClientRect().width;   // 305.89
```

Le titre de rôle se mesure en **32 px `font-weight: 700`** (≈ 16,1 px par
caractère dans `Inter, system-ui, sans-serif`), et il ne dispose que de
**356 px** : un rôle plus long élargit toute la scène. Le build refuse de toute
façon toute ellipse (`scrollWidth > clientWidth`) et tout débordement vertical
(`scrollHeight > clientHeight`) : préférer raccourcir le libellé plutôt
qu'élargir la carte.

**Piège mesuré** : une `line-height` inférieure à ~1,27 em fait déborder la boîte
de glyphes de la boîte de ligne, donc `scrollHeight > clientHeight` sur toutes les
cartes. Garder **`line-height: 1.3`** sur les cinq lignes de texte — c'est aussi
elle qui fixe la taille de l'icône.

## 4. Mise en page

- **Orientation `rankdir: 'LR'`** — c'est la baseline. **Ne jamais la changer.**
- `NODESEP = 24`, `RANKSEP = 72` : réglés pour la carte 460 × 200. Balayage
  mesuré 24/32/40/48 × 72/88/104/120 — les seize couples placent tous les
  libellés d'arête, 24/72 donne la plus petite scène (hébergement
  4 376 × 1 948 contre 4 600 × 2 044 à 40/104). Resserrer davantage ne se tente
  qu'en revérifiant `placeLabels()`.
- Placement Dagre **récursif** : chaque `subgraph` Mermaid reste une vraie boîte
  parente, jamais un remplacement de ses feuilles. `SUBFLOW_HEADER_SPACE = 96`.
- Les libellés d'arête sont posés hors de toute carte et de tout en-tête de
  conteneur ; `placeLabels()` lève une erreur plutôt que de superposer.
- `CANVAS` dans `report-render.mjs` doit rester **juste plus grand que la plus
  large scène** (5 700 × 2 400 pour une scène de 5 472 px) : trop grand,
  Chromium compose en tuiles et en perd.

## 5. Annexe A4 portrait — une scène entière par page (contrat owner, v11)

Plus aucune découpe. Chaque page d'annexe porte **la scène entière**, incluse
comme la figure du corps : ajustée à la largeur de page, échelle < 1 assumée.

- Page A4 **portrait**, marge 10 mm, en-tête 54 px, bloc de commentaire 168 px,
  soit une boîte d'image utile **716 x 823 px** (`ANNEX_IMAGE`).
- `annexFit()` = `min(largeur utile / largeur scène, hauteur utile / hauteur
  scène)`. Les scènes étant `LR`, c'est **toujours la largeur qui commande** —
  `mapping.test.mjs` refuse une scène qui serait limitée par la hauteur.
- **Il n'y a plus de plancher à 6 pt.** L'owner a tranché : la scène entière
  prime sur une découpe lisible à l'impression. Le corps effectif est **mesuré**
  dans la page rendue (`(imageBox.width - 2) / naturalWidth`) et **écrit dans
  l'en-tête de page**, avec la taille native de l'image.
- Le seul plancher qui reste est relatif : une page d'annexe ne doit jamais être
  **plus petite que la figure inline** qu'elle complète (barrière dans
  `report-render.mjs`).
- L'image garde sa **résolution native** dans le PDF (`pdfimages -list` : 585 à
  735 ppi ici) : illisible à l'œil nu sur papier, nette au zoom dans le PDF.
  L'en-tête de page le dit.
- Sous l'image, un **commentaire de transition** obligatoire (`SCENE_TRANSITION`),
  dans l'esprit du dossier de décision codex-13-sept : comment on est arrivé à
  l'état montré, en faits datés déjà présents dans le corps du rapport, 3 à 6
  lignes, sans jargon. `report-finalize.mjs` échoue sous 3 lignes rendues.
- Barrières mesurées après mise en page, avant impression : image entière dans
  son cadre, rapport d'aspect conservé, page qui ne déborde pas de sa boîte A4,
  commentaire non tronqué, échelle mesurée = échelle annoncée (± 0,002).

Ordre de grandeur mesuré sur ce dépôt (carte 460 × 200, 24/72) : hébergement
4 360 × 1 995 à 2 107 px → 16,4 % → **2,71 pt** ; pipeline 4 940 à 5 472 × 1 247
à 1 293 px → 13,1 à 14,5 % → **2,16 à 2,39 pt**. Total **5 pages d'annexe**
(A1, A2, A3, B1, B2).

## 6. Inline dans le corps du rapport

**Deux** figures inline, injectées **au rendu**, jamais dans le Markdown source
(`INLINE_SCENES`) : la cible d'hébergement après le premier paragraphe de la
section 6, et la cible de pipeline après le paragraphe « Après » de la section 5.
Chacune **<= 1/2 page A4 portrait** (`withinHalfPage: true` dans
`.generated/report-render.json`). Même légende dans les deux cas : scène, date,
taux de réduction, renvoi à la page pleine d'annexe, liste de la partie d'annexe.

## 6 bis. Rapport précédent — cité, jamais embarqué (v11)

Le rapport du mois précédent n'est **ni concaténé ni attaché** au PDF : le
document se termine après ses annexes. Il est cité par chemin dans l'en-tête
(`docs/reports/rapport-mois-<precedent>.pdf`). `report-finalize.mjs` copie
simplement `current-report.pdf` et **vérifie l'absence** du texte du
prédécesseur ; `report-check` vérifie qu'aucune pièce jointe ne subsiste
(`pdfdetach -list` = 0).

## 7. Cibles Makefile (`docs/architecture/focus/Makefile`)

`ENV` est **le dernier argument de make**, jamais une variable d'environnement.

```bash
make -f docs/architecture/focus/Makefile chrome-run ENV=<env>     # Chromium CDP 9238, à lancer en premier
make -f docs/architecture/focus/Makefile map ENV=<env>            # Mermaid vers .generated/data.json
make -f docs/architecture/focus/Makefile test ENV=<env>           # tests + git diff --check
make -f docs/architecture/focus/Makefile build ENV=<env>          # map + mermaid + vite + dossier + rapport + PDF
make -f docs/architecture/focus/Makefile browser ENV=<env>        # contrôles Chromium 1440x1000 et 1920x1080
make -f docs/architecture/focus/Makefile report-check ENV=<env>   # la barrière : exit 0 obligatoire
```

`build` a besoin du Chromium de `chrome-run` déjà démarré. Après toute stack
lancée pour l'occasion : **`down -v`**.

## 8. Preuves exigées

Aucune affirmation sans mesure. Le livrable porte :

- capture **vue d'ensemble** et capture **1:1** par scène, prises dans Chromium
  réellement ouvert (`file://…/decision-focus.html`), pas un rendu simulé ;
- une capture **1:1 d'une carte A'** par scène, avec l'icône mesurée en px
  (icône = hauteur des deux premières lignes, à 1 px près) ;
- un JSON d'inspection par scène : échelle, nombre de cartes, conteneurs,
  arêtes, **chevauchements = 0**, **ellipses = 0**, **lignes de statut = 0** ;
- les pages d'annexe extraites du PDF (`pdftoppm -r 150 -cropbox`) et **ouvertes
  et relues** une par une, plus la ou les pages du corps qui portent une figure ;
- la **mesure indépendante** de chaque page d'annexe dans le raster (boîte de la
  scène en px, échelle déduite, corps effectif en pt) — pas seulement la mesure DOM ;
- `docs/reports/architecture-monthly/evidence-manifest-<date>.json` : empreintes
  de scène, `printScale`, `minTypePt` mesuré, pages, référence du rapport précédent ;
- `make browser` doit répondre `{"status":"pass", …, "offline":true}`.

## 9. Interdits

1. **Ne jamais supprimer un composant de la baseline.** Un composant peut muter
   (autre support, autre environnement) ou passer hors-scène — avec une raison
   datée, inscrite dans le tableau baseline vers version. Repasser le tableau
   complet à chaque version.
2. **Ne jamais changer l'orientation** `LR`.
3. Ne jamais remplacer un libellé par une version tronquée « compacte » : le
   libellé canonique Mermaid reste la source, la carte en montre une forme courte
   et l'info-bulle porte le libellé entier (`title={data.label}`).
4. Ne jamais toucher au texte des sections du rapport depuis cette chaîne : seules
   les **légendes de scènes** et la figure injectée sont de son ressort.
5. Pas de logo fournisseur : les icônes sont des pictogrammes locaux.
6. Pas de surzoom en annexe (échelle toujours < 1) et **jamais de découpe** :
   une scène = une page. Une page d'annexe ne descend jamais sous l'échelle de
   la figure inline correspondante.
7. **Ne jamais réintroduire un second gabarit de carte** ni une ligne de statut :
   un composant passif est une carte A' dont le rôle dit ce qu'il est.

## 10. Recette de bout en bout

```bash
# 1. démarrer le Chromium de contrôle
make -f docs/architecture/focus/Makefile chrome-run ENV=<env> &

# 2. éditer la source canonique puis les cartes
#    docs/architecture.md                       (topologie, conteneurs, arêtes)
#    docs/architecture/focus/scene-metadata.js  (card/code/role/name/detail/états)

# 3. boucle courte
make -f docs/architecture/focus/Makefile map ENV=<env>
make -f docs/architecture/focus/Makefile test ENV=<env>

# 4. rendu complet et barrières
make -f docs/architecture/focus/Makefile build ENV=<env>
make -f docs/architecture/focus/Makefile browser ENV=<env>
make -f docs/architecture/focus/Makefile report-check ENV=<env>

# 5. preuves
pdftoppm -f <p> -l <p> -singlefile -png -r 150 -cropbox docs/reports/<rapport>.pdf proof/annex-<p>
# puis ouvrir et relire chaque page
```

## 11. Messages d'erreur et ce qu'ils veulent dire

| Message | Cause | Correctif |
|---|---|---|
| `<scene>/<id>: code repeated inside the name` | le code figure dans `name` | renommer le nom, pas le code |
| `<scene>/<id>: role title "…" is not two-by-two short` | rôle à plus de 2 segments ou 2 mots par segment | raccourcir, l'environnement va dans le nom |
| `<scene>/<id>: card needs code, role, name and detail` | une des quatre lignes est vide | toute carte porte les quatre |
| `<scene>/<id>: a container carries no role title` | un `BOX` a reçu un rôle | retirer le rôle |
| `<scene>: ellipsised card text <id>/<role>` | texte plus large que la carte | raccourcir le libellé (mesurer d'abord) |
| `<scene>/<id>: card content clipped vertically` | `line-height` sous la boîte de glyphes | remettre `line-height: 1.3` |
| `<scene>/<id>: icon … is not the height of the two first lines` | `ICON` ne suit plus les polices | recalculer 22 × 1,3 + 32 × 1,3 |
| `<scene>/<id>: a status line is still rendered` | une ligne de statut est revenue | la retirer, l'état va dans le détail |
| `No node-clear label placement for <edge>` | `nodesep`/`ranksep` trop serrés | remonter `RANKSEP`, ou allonger l'échelle d'offsets de `placeLabels()` |
| `<annexe>: the scene does not fit whole inside the page frame` | image plus grande que la boîte utile | recalculer `ANNEX_IMAGE` (en-tête + commentaire) |
| `<annexe>: the transition commentary is clipped` | commentaire trop long pour 168 px | raccourcir, ou remonter `ANNEX.comment` et refaire le calcul de `ANNEX_IMAGE` |
| `<annexe>: measured fit X differs from the announced Y` | l'en-tête annonce une échelle fausse | ne pas publier : la page ment sur sa propre mesure |
| `<annexe>: the annex page is smaller than the inline figure of the body` | l'annexe n'apporte plus rien | revoir marges et boîte d'image |
| `the preceding report is still embedded in the pages` | concaténation revenue | `report-finalize.mjs` ne doit que copier |
| `<scene>: capture WxH exceeds the … surface` | scène plus large que `CANVAS` | élargir `CANVAS` juste au-dessus de la scène |
| `<scene>: incomplete native capture inventory` | capture partielle de Chromium | réduire la surface `CANVAS` de `report-render.mjs` |
