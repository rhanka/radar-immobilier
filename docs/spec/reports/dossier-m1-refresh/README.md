# Dossier de décision M1 (v3) au format h2a Focus

`decision-focus.html` — page unique, autonome, ouvrable **hors ligne** en
`file://`. Elle empile les quatre blocs du format Focus :

1. **Bandeau** — eyebrow, badge d'inventaire (`2 SCÈNES · 7 SECTIONS · 14 SEPTEMBRE
   2026`), titre, lede, bande de cinq faits mesurés.
2. **Les 7 sections** du dossier, dépliables, dans leur texte d'origine.
3. **Deux scènes** SvelteFlow natives.
4. **Le choix de §7**, sélectionnable et exportable en JSON — brouillon local.
   L'annexe glossaire ferme la page.

## Fond

`DOSSIER_DECISION_M1_REFRESH_2026-09-14.md` reprend
`tmp/t1-model-benchmark-real/docs/reviews/refresh-benchmark/DECISION_M1.md` (v3,
après la campagne v100) **octet pour octet** sur ses 797 lignes ; seule une
**annexe B** est ajoutée, qui porte les deux blocs Mermaid canoniques des scènes.
Aucune phrase du dossier n'est réécrite.

## Les deux scènes

| Scène | Identifiant | Inventaire mesuré |
| --- | --- | --- |
| 1 · Chaîne de mesure | `chaine-de-mesure` | 18 cartes · 5 transitions · 6 conteneurs |
| 2 · Résultats v4 → v100 | `resultats-v4-v100` | 21 cartes · 5 liens · 6 conteneurs |

**Scène 1** : les six couches de validation de §3 en conteneurs `rankdir LR` —
transport → JSON → structure → profil → provenance → accepté. Chaque conteneur
porte trois cartes A' : ce qu'on vérifie, le refus réellement observé sur la
campagne v100 (classe et effectif), un exemple réel. Les cinq arêtes libellées
portent le passage mesuré d'une couche à la suivante (`HTTP 200 · 100/100`,
`bloc retiré · 100/100`, `graphe formé · 100/100`, `profil valide · 93/100`,
`ancrage vérifié · 87/93`).

**Scène 2** : une carte par campagne (contrat, modèle, plafond, acceptés, latence
moyenne, F1 — ou les deux juges aveugles pour v100), groupées par époque et
reliées en chronologie par ce qui a débloqué la suivante. Le dernier conteneur
porte les quatre options de §6 avec leur **plafond mesuré** : A 87 %, B′ 87 → 93 %,
C′ 87 → 96 %, D′ variance à corpus fixe.

## Chaîne — importée, pas recopiée

`focus/` importe `docs/architecture/focus/` par chemin relatif, qui importe
lui-même le kit h2a monté en lecture seule sur `/kit` : `parse-mermaid.mjs`,
`scenes.js` (Dagre LR récursif, routeur orthogonal, `placeLabels`), `Flow.svelte`
et ses nœuds, `style.css`, `roleIsShort()`. Propre au dossier : `build-map.mjs`,
`scene-metadata.js`, `App.svelte`, `Scenes.svelte`, `Sections.svelte`,
`DecisionChoices.svelte`, `choices.js`, `portable.mjs`, `browser-check.mjs`,
`mapping.test.mjs`, `Makefile`.

Aucun fichier de `docs/architecture/` n'est modifié ; aucune écriture dans
`~/src/sentropic`.

## Rejouer

```bash
cd docs/spec/reports/dossier-m1-refresh/focus
make deps          # dépendances de la chaîne d'architecture
make test          # carte canonique + 8 tests de contrat et de géométrie
make build         # page portable -> ../decision-focus.html
make chrome-run &  # Chromium réel, CDP 127.0.0.1:9241
make browser       # contrôles Chromium + captures
make proofs        # copie les preuves dans ../preuves/
```

## Preuves

`preuves/` — `browser-check.json`, `portable.json` et **6 captures** :
`dossier-preview-1440x1000.png`, `dossier-preview-1920x1080.png`,
`scene-vue-ensemble-{chaine-de-mesure,resultats-v4-v100}.png`,
`scene-1a1-{chaine-de-mesure,resultats-v4-v100}.png`.

Ouvrir cette page n'exécute rien : aucun appel de modèle, aucune campagne, aucune
fusion de PR, aucune modification de contrat, de prompt, de schéma ou de
validateur, aucun événement track.
