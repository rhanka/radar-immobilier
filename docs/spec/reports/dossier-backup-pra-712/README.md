# Dossier de décision v3 « Sauvegardes et PRA d'ensemble immo + geo » (PR #712, rhanka/geo#390, carte #698) au format h2a Focus

`decision-focus.html` — page unique, autonome, ouvrable **hors ligne** en
`file://`. Elle porte le dossier actualisé sur la **spécification PRA v3**
(`SPEC_PRA_V3_2026-09-19.md` réconciliée : 31 constats des deux revues absorbés,
exigence RPO-1 des 24 h et complément « débits » intégrés). Elle remplace la page
du 19/09, qui décrivait la conception d'avant cette spécification.

Quatre blocs du format Focus :

1. **Bandeau** — eyebrow, badge d'inventaire calculé sur les données, titre, lede,
   et **l'état réel en tête** : spec corrigée et réconciliée ; sauvegarde planifiée
   de la prod **aucune** (dernier point vieux de 8 jours, RPO non borné) ; clés de
   scellement sans export trouvé, rotation vers le 22/09 ; RTO-1 **non acquis** ;
   quatre passages de l'owner **ouverts** ; dossier précédent **périmé**.
2. **Les 13 sections** ; la section 1 est ouverte, les autres dépliables.
3. **Trois scènes**, un seul rendu : xyflow placé par ELK.
4. **Les questions de §12 et le choix de vue de §13**, sélectionnables et
   exportables en JSON — brouillon local, rien n'est ratifié. Les annexes A à C,
   verbatim, ferment la page.

## Fond

`DOSSIER_DECISION_BACKUP_PRA_V2_2026-09-18.md` (le nom de fichier est conservé pour
ne pas casser les renvois ; le contenu est celui de la v3 du 2026-09-20). Sections :
1 décision et état réel · 2 la demande de l'owner, ce qui fait foi · 3 couverture
contre le verbatim, fragment par fragment (V1 à V44) · 4 architecture cible, zones,
symétrie, clés · 5 processus, déclencheurs, garde-fous, régimes · 6 deux niveaux,
RPO 24 h, débits · 7 rétention, verrou, externalisation, conformité · 8 objectifs de
reprise · 9 alertes de bout en bout · 10 k8s facilitateur, garde, secrets ·
11 mesures conservatoires et exercices · 12 ce que j'attends de toi · 13 rendu des
schémas.

Annexes, textes intégraux repris octet pour octet (six empreintes contrôlées par
`mapping.test.mjs`) :

- **A** — les deux revues contradictoires de la spec v3 : Fable 5.1, Gemini 3.8 high ;
- **B** — les faits : inventaire k8s (clés de scellement comprises), faits de rendu
  (archify, bpmn-js), divergences résiduelles ;
- **C** — la demande de l'owner, sections 1 à 5 ;
- **D** — les trois blocs Mermaid canoniques des scènes.

**Une dérogation de forme, déclarée** : la revue Gemini porte une espace en fin de
ligne (ligne 197) que la chaîne du dépôt refuse (`git diff --check`). L'annexe
reproduit ce texte sans cette seule espace ; c'est la seule différence avec la
source, et les cinq autres textes sont identiques octet pour octet.

## Les trois scènes

Une seule description par scène : le bloc Mermaid canonique de l'annexe D joint aux
métadonnées de `focus/scene-metadata.js`. Le titre affiché est celui que porte
l'annexe D, pas une copie figée dans le code.

| Scène | Identifiant | Inventaire |
| --- | --- | --- |
| 1 · le cluster, ses tenants et leurs environnements, entre l'utilisateur et l'administration | `architecture-sauvegardes` | 48 cartes · 26 liens · 20 conteneurs ; cinq colonnes entre le nord et le sud (GitHub · hors GitHub · cluster · buckets OVH · autre région), cluster > tenant > environnement |
| 2 · déclencheurs et reprise, de la demande au reçu | `sequence-bout-en-bout` | 20 cartes · 19 liens · 4 conteneurs |
| 3 · mesures conservatoires, lots, exercices | `mise-en-service` | 17 cartes · 16 liens · 3 conteneurs |

**Rendu « xyflow · ELK »** — SvelteFlow natif (cartes `ServiceNode`, conteneurs
`Subflow` de la chaîne), placé au build par **ELK** (`elkjs` 0.12.0, `layered`,
routage `ORTHOGONAL`, étiquettes placées par ELK, `focus/elk-layout.mjs`) :
architecture en mode `frame` — la mise en page **imposée par l'owner**
(DOSSIER_PRA_V3_LAYOUT_SPEC : utilisateur au nord, administration et coffre au sud,
et entre les deux une bande de cinq colonnes — GitHub, hors GitHub, cluster k8s,
buckets OVH, réplication en autre région) tenue par un **cadre fixe dimensionné sur
les tailles que les sous-placements renvoient**. Le moteur ne choisit plus
l'emplacement des blocs : il place à l'intérieur des seuls conteneurs que le plan
ne nomme pas. L'ordre imposé est tenu par le placement semi-interactif d'ELK, qui
garde le routage ; les tronçons de bloc à bloc sont tracés dans les couloirs, et
deux colonnes non voisines se joignent **au-dessus** de la bande, sans traverser la
colonne intercalée. Séquence et mise en service : conteneurs placés séparément,
avec repliement de graphe et ports hiérarchiques.

**Graphviz : supprimé (ARCH-7).** Plus de `gv-layout.mjs`, plus de
`GraphvizView.svelte`, plus de bascule entre rendus, plus de source `dot`, plus de
dépendance `@hpcc-js/wasm-graphviz`, plus de preuve `*-graphviz-*`. Un test de
`mapping.test.mjs` balaie tous les fichiers de `focus/` et **échoue si le mot
réapparaît** ailleurs que dans une phrase qui constate la suppression.

**Rendu archify (ARCH-8)** — `archify/`, produit hors ligne depuis le clone local
d'archify (MIT), sans aucune installation réseau :
`pra-v3-architecture.architecture.json` → `.html` (six zones en colonnes, 24 cartes)
et `pra-v3-pbi.workflow.json` → `.html` (P-bi, 5 couloirs). Les deux passent
`archify check` (`ok: true`). Limites dites en section 13 : pas de conteneurs
imbriqués, validation de placement qui refuse toute liaison traversant une carte
tierce, type `workflow` limité à 6 colonnes, et plancher de lisibilité propre à
archify (6 px projetés) **deux fois plus bas que le nôtre**.

**Chaîne graphify : évaluée et écartée** — moteur de graphe de connaissance à
placement par forces, sans cadre de conteneur ni diagramme de séquence. La page le dit.

**Réglages choisis par la lisibilité** (`focus/sweep-legibility.mjs`, `make sweep`) :
pour chaque scène, un balayage borné des réglages natifs d'ELK — **232 candidats pour
la scène 1**, sur le plan imposé, **672 pour les deux autres** — chacun
placé, passé aux contrôles géométriques et à la porte de grille, puis mesuré. Retenu : parmi
les candidats aux contrôles verts, celui dont la marge la plus faible aux portes de
lisibilité est la plus grande. Tableau complet dans `preuves/balayage-lisibilite.csv`,
résumé dans `preuves/balayage-lisibilite.md` ; un test vérifie que les réglages de la
page sont ceux que le balayage a retenus.

## Contrôles de placement

Une seule fonction, `focus/geometry-check.mjs`, appliquée trois fois : au build
(`build-map.mjs` **refuse de construire** la page si un contrôle échoue), dans
`mapping.test.mjs`, et dans Chromium sur la géométrie **réellement rendue**, à
1440 × 900 et 1920 × 1080 :
- extrémité de chaque liaison sur le bord d'une boîte (±3 px) ; boîte à liaison
  unique : extrémité au milieu du bord (±4 px) ;
- aucun croisement d'une liaison avec une boîte non concernée, ni avec ses propres cartes ;
- **porte de grille** (scène à cadre) : un conteneur de **quatre cartes ou plus** occupe
  **au moins deux colonnes** — un tenant rangé sur une colonne arrête le build ;
- étiquette à 6 px au plus de sa liaison, et sur aucune carte ;
- rapport largeur / hauteur entre 4:3 et 16:9 ;
- tracés orthogonaux ; impression : un PDF, A4 paysage, chaque schéma entier sur sa page ;
- **gabarit des cartes** : toutes les cartes hors gabarit sont rapportées ensemble, y
  compris **tout libellé tronqué** — c'est ce contrôle qui a refusé la carte
  `G3-PP` tant que son rôle ne tenait pas dans la carte.

Mesures (Chromium, identiques à 1440 et 1920) : **0 extrémité hors bord, 0 croisement,
0 étiquette détachée ou sur une carte, 0 px d'écart au milieu** ; rapports 1,423 /
1,651 / 1,707. Page : **0 erreur de console, 0 erreur d'exécution, 0 requête externe**.

## Lisibilité : portes ratifiées, et pourquoi elles ne sont pas tenues

- **taille effective** de chaque texte = taille calculée × zoom réellement appliqué,
  une fois la scène ajustée à la zone d'affichage ;
- **portes ratifiées** : à 1440 × 900, aucun texte sous **12 px** ; en A4 paysage,
  **8 pt pour le texte de lecture** et **7 pt pour l'annotation secondaire**
  (étiquette de liaison), contrôlés **rôle par rôle** ;
- le **taux de remplissage n'est plus contractuel** : il reste publié comme indicateur.
  La règle ratifiée est **qu'un libellé ne s'affiche que s'il tient sans troncature** ;
- le build **refuse la page** sous les portes, sauf dérogation explicite et motivée
  (`LEGIBILITE_DEROGATION="motif"`), inscrite au manifeste, affichée dans la page et
  reprise par le contrôle Chromium ;
- Chromium mesure la même chose sur le DOM rendu et vérifie que le modèle du build
  donne la même valeur : écart maximal constaté **0,000 px**.

État au 2026-09-20 : **aucune scène ne tient les portes**. Plus petit texte, scène
ajustée à la vue, à 1440 × 900 : architecture **3,35 px**, séquence **5,97 px**, mise
en service **7,21 px** ; en A4 : 2,09 / 4,00 / 4,68 pt. La page est produite par
dérogation motivée. C'est le **nombre de cartes** qui décide, pas le moteur : au-delà
d'une dizaine de cartes par vue, aucun placement ne tient le plancher. Les trois
options de vue — scinder par domaine, ouvrir à taille lisible, garder la vue compacte —
sont présentées en section 13 et **attendent la décision de l'owner**.

## Chaîne — importée, pas recopiée

`focus/` reprend le kit du dossier M1 et importe `docs/architecture/focus/` par chemin
relatif (cartes, conteneurs, `Viewport`, `style.css`, parseur Mermaid). Propre au
dossier : `elk-layout.mjs`, `geometry-check.mjs`, `ElkFlow.svelte`, `ElkEdge.svelte`,
`build-map.mjs`, `scene-metadata.js`, `App.svelte`, `Scenes.svelte`, `Sections.svelte`,
`DecisionChoices.svelte`, `choices.js`, `portable.mjs`, `browser-check.mjs`,
`mapping.test.mjs`, `sweep-legibility.mjs`, `package.json`, `Makefile`. Aucun fichier de
`docs/architecture/` n'est modifié ; aucune écriture dans `~/src/sentropic`.

## Rejouer

```bash
cd docs/spec/reports/dossier-backup-pra-712/focus
make deps          # chaîne d'architecture + elkjs (package.json)
make sweep         # balayage de lisibilité -> ../preuves/balayage-lisibilite.*
make test          # carte canonique, placements contrôlés et mesurés + 15 tests
make build         # page portable -> ../decision-focus.html
make chrome-run &  # Chromium réel, CDP 127.0.0.1:9242
make browser       # contrôles Chromium, mesure de lisibilité, captures
make proofs        # copie les preuves dans ../preuves/
```

Tant qu'une scène est sous les portes, `make test` et `make build` s'arrêtent ; pour
produire la page malgré tout :
`make build LEGIBILITE_DEROGATION="décision owner attendue : aucun placement natif ne tient 12 px ni 8 pt, options de vue A/B/C en section 13"`
(même argument pour `make test`).

Rendus archify (hors ligne, depuis un clone local d'archify) :

```bash
cd docs/spec/reports/dossier-backup-pra-712/archify
archify render architecture pra-v3-architecture.architecture.json pra-v3-architecture.html
archify render workflow     pra-v3-pbi.workflow.json             pra-v3-pbi.html
archify check pra-v3-architecture.html && archify check pra-v3-pbi.html
```

## Preuves

`preuves/` — `browser-check.json` (géométrie : 6 mesures ; lisibilité : 9 mesures,
3 scènes × 3 formats ; impression), `balayage-lisibilite.{csv,md,json}`,
`portable.json`, et les captures nommées par rendu :
`dossier-preview-elk-{1440x900,1920x1080}.png`,
`scene-ajustee-1440x900-elk-<scène>.png` (scène ajustée à la vue),
`scene-vue-ensemble-elk-<scène>.png`, `scene-1a1-elk-<scène>.png`,
`impression-elk.pdf`.

Ouvrir cette page n'exécute rien : aucune fusion de PR, aucun provisionnement, aucun
déploiement, aucune sauvegarde ni restauration, aucune action cluster ou OVH, aucun
événement track.
