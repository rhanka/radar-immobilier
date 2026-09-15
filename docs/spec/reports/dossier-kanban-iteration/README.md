# Dossier de décision Kanban / itération — rendu Focus

`decision-focus.html` est le dossier
[`DOSSIER_DECISION_KANBAN_ITERATION_2026-09-14.md`](../DOSSIER_DECISION_KANBAN_ITERATION_2026-09-14.md)
rendu au format h2a Focus : page autonome, hors ligne, deux scènes SvelteFlow
natives, et les choix de §7 réellement sélectionnables.

**Le fond n'est pas réécrit.** Le Markdown est la source : ses sept sections et
son annexe A sont découpées sur leurs titres de niveau 2 et rendues telles
quelles ; son annexe B porte les deux blocs Mermaid canoniques des scènes.

## Ce qui est réutilisé, et ce qui est propre à ce dossier

La chaîne de `docs/architecture/focus` est **importée**, jamais recopiée — et
elle importe elle-même le kit h2a monté en lecture seule sur `/kit` :

| Réutilisé depuis `docs/architecture/focus` | Propre à ce dossier |
|---|---|
| `parse-mermaid.mjs` (parseur du sous-ensemble Mermaid) | `build-map.mjs` (deux scènes, découpe des sections) |
| `scenes.js` (Dagre récursif `rankdir LR`, routeur `/kit/src/architecture-routing.js`, `placeLabels`) | `scene-metadata.js` (contenu des cartes, contrat de gabarit) |
| `Flow.svelte`, `ServiceNode.svelte`, `Subflow.svelte`, `RoutedEdge.svelte`, `ServiceIcon.svelte`, `Viewport.svelte`, `service-icons.js` | `App.svelte`, `Scenes.svelte`, `Sections.svelte`, `DecisionChoices.svelte` |
| `style.css` (jetons et mise en page) | `choices.js` (les questions de §7) |
| `roleIsShort()` (règle « deux par deux » des titres de rôle) | `portable.mjs`, `browser-check.mjs`, `mapping.test.mjs`, `Makefile` |
| les dépendances npm (cible `deps` de sa `Makefile`) | — |

`DecisionChoices.svelte` n'est pas un doublon de `Choices.svelte` : §7 demande
une liste **cochable** (plusieurs réponses) que le composant d'architecture, en
boutons radio seulement, ne sait pas exprimer.

## Les deux scènes

| Scène | Contenu | Mesuré |
|---|---|---|
| `way-of-working` | Les 8 colonnes owner + « En prod (clos) » en conteneurs LR ; par colonne, cinq cartes A' : colonne owner et borne de WIP, critère d'entrée, critère de sortie, la main qui déplace (avec l'état de l'automatisation), artefact attendu. Transitions en arêtes libellées. | 45 cartes · 8 transitions · 9 conteneurs · fitView 0,2378 |
| `iteration-15-jours` | Les items recommandés de §4.2 dans leur colonne de départ (jour 0, design S1, design S2, dev, à déployer prod), ordre et semaine en détail, dépendances de §4.3 en arêtes libellées. | 12 cartes · 7 dépendances · 5 conteneurs · fitView 0,3942 |

Le gabarit reste celui ratifié par l'owner : **carte unique A' 460 × 200 à
l'échelle 1**, cinq lignes, icône haute comme les deux premières lignes, aucune
ligne de statut, `rankdir LR`.

## Rejouer

```bash
FOCUS=docs/spec/reports/dossier-kanban-iteration/focus/Makefile
make -f $FOCUS deps    ENV=test-dossier-kanban   # dépendances de la chaîne d'architecture
make -f $FOCUS map     ENV=test-dossier-kanban
make -f $FOCUS test    ENV=test-dossier-kanban
make -f $FOCUS build   ENV=test-dossier-kanban   # decision-focus.html autonome
make -f $FOCUS chrome-run ENV=test-dossier-kanban  # Chromium CDP 9239, à lancer avant
make -f $FOCUS browser ENV=test-dossier-kanban
make -f $FOCUS proofs  ENV=test-dossier-kanban
```

## Preuves

`preuves/browser-check.json` porte la mesure complète : projection native
identique à la projection canonique des deux graphes, contrat de carte vérifié
sur les 57 cartes, zéro superposition, zéro ellipse, zéro ligne de statut,
libellés d'arête à 24 px à l'intérieur du panneau, contenu entier dans la vue,
bouton 1:1 qui remet réellement l'échelle à 1, choix sélectionnables (7 blocs,
19 boutons radio, 12 cases à cocher) et export JSON réel — **0 erreur console,
0 exception, 0 requête externe**.

Captures : vue d'ensemble et vue 1:1 par scène, page complète en 1440 × 1000 et
1920 × 1080.

Ouvrir la page n'exécute rien : aucune issue, aucun projet GitHub, aucun
événement track, aucun déploiement. Les réponses cochées restent un brouillon
local, non ratifié.
