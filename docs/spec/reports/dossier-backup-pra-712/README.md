# Dossier de décision v2 « Sauvegardes et PRA d'ensemble immo + geo » (PR #712, rhanka/geo#390, carte #698) au format h2a Focus

`decision-focus.html` — page unique, autonome, ouvrable **hors ligne** en
`file://`. Elle remplace la page v1, qui décrivait la première version de la PR,
rejetée. Elle empile les quatre blocs du format Focus :

1. **Bandeau** — eyebrow `#698 · Sauvegardes & PRA d'ensemble · PR #712 +
   rhanka/geo#390 · v2`, badge d'inventaire calculé sur les données
   (`3 SCÈNES · 12 SECTIONS · 18 SEPTEMBRE 2026`), titre, lede, et **l'état réel
   en tête** en six faits : revues non fusionnable ; provisionnement gelé en
   attente de D2 ; preuve préprod pas faite ; mesures geo pas faites ; aucune
   fusion, aucune activation ; recommandation « corriger avant fusion ».
2. **Les 12 sections** du dossier ; la section 1 (décision et état réel) est
   ouverte, les autres dépliables.
3. **Trois scènes** SvelteFlow natives.
4. **Les choix de §12** (D1 à D5), sélectionnables et exportables en JSON —
   brouillon local. Les annexes A à C, verbatim, ferment la page.

## Fond

`DOSSIER_DECISION_BACKUP_PRA_V2_2026-09-18.md`, rédigé par la lane à partir du
brief `DOSSIER_BACKUP_V2_BRIEF.md`, des deux revues, des deux agréments, du
code de la PR #712 à HEAD `5ee7900c` (chaque défaut y a été re-vérifié) et du
plan geo de geo#390. Sections : 1 décision et état réel · 2 livré · 3
contraintes OVH mesurées et l'épisode de la mesure faussée · 4 défauts des
revues, un par un, avec leur état (ouvert, contesté avec preuve) · 5 agrément
k8s, modèle de clés, réserves R1 à R7 · 6 co-validation i-infra (validée,
invalidée, reconduite) · 7 séquence de bout en bout · 8 mise en service · 9
options · 10 recommandation · 11 critères · 12 décisions D1 à D5.

Annexes, textes intégraux repris octet pour octet (empreintes contrôlées par
`mapping.test.mjs`) :

- **A** — revues de la livraison actuelle : Fable 5.1, Gemini 3.8 high ;
- **B** — agréments : lane k8s (clés comprises), co-validation i-infra ;
- **C** — revues de la première version, datées du 2026-09-17 (historique) ;
- **D** — les trois blocs Mermaid canoniques des scènes.

Les textes verbatim portent leurs propres titres `##` (dont `## 1.` chez
Gemini) : avant l'annexe A, tout titre `##` découpe ; après, seuls les titres
`## Annexe X —`.

## Les trois scènes

| Scène | Identifiant | Inventaire mesuré |
| --- | --- | --- |
| 1 · Architecture immo + geo | `architecture-sauvegardes` | 22 cartes · 10 liens · 6 conteneurs |
| 2 · Séquence de bout en bout | `sequence-bout-en-bout` | 13 cartes · 12 liens · 2 conteneurs |
| 3 · Mise en service | `mise-en-service` | 14 cartes · 13 liens · 3 conteneurs |

**Scène 1** : immo préproduction et production (bases PostgreSQL, CronJobs,
restauration éphémère, quota), sauvegardes immo sur S3 OVH bhs (buckets par
environnement, préfixes, verrou, cycle de vie), les trois identités et les clés
du propriétaire, la surveillance, le volet geo (source, irremplaçables, copie,
reprise). L'**état** de chaque carte est visible : filet et fond selon
`runtimeState` — existant (`active`), livré non actif (`dormant`), provisionné
mais gelé (`suspended`), n'existe pas encore (`not-applicable`, trait
pointillé), hors cluster (`manual`). Une légende est rendue au-dessus de la
scène. Ce style est porté par `Scenes.svelte`, sans toucher à la chaîne.

**Scène 2** : un cycle de sauvegarde (identifiant commun, gel immo seul, dump
dans la transaction, copies immo puis geo sans gel, marqueur en dernier, dégel)
puis la restauration dans l'ordre inverse de la dépendance. Chaque carte porte
qui exécute et la preuve ; seule l'étape S-3 est livrée.

**Scène 3** : la preuve avant la fusion (M-1 à M-9), la fusion et l'activation
simultanée (F-1, F-2), puis les premiers Jobs et la réactivation de la fraîcheur
(A-1 à A-3). Chaque carte nomme l'acteur et le garde-fou ; l'arête sortante
porte la preuve de sortie. Toutes les étapes sont à faire.

## Chaîne — importée, pas recopiée

`focus/` reprend le kit du dossier M1 (`docs/spec/reports/dossier-m1-refresh/focus`,
branche `docs/dossier-kanban-iteration`, PR #694) et importe
`docs/architecture/focus/` par chemin relatif, qui importe lui-même le kit h2a
monté en lecture seule sur `/kit`. Propre au dossier : `build-map.mjs`,
`scene-metadata.js`, `App.svelte`, `Scenes.svelte`, `Sections.svelte`,
`DecisionChoices.svelte`, `choices.js`, `portable.mjs`, `browser-check.mjs`,
`mapping.test.mjs`, `Makefile`. Aucun fichier de `docs/architecture/` n'est
modifié ; aucune écriture dans `~/src/sentropic`.

## Rejouer

```bash
cd docs/spec/reports/dossier-backup-pra-712/focus
make deps          # dépendances de la chaîne d'architecture
make test          # carte canonique + 9 tests (état réel, verbatim, défauts, scènes, choix, gabarit, géométrie)
make build         # page portable -> ../decision-focus.html
make chrome-run &  # Chromium réel, CDP 127.0.0.1:9242
make browser       # contrôles Chromium + captures
make proofs        # copie les preuves dans ../preuves/
```

## Preuves

`preuves/` — `browser-check.json`, `portable.json` et **8 captures** :
`dossier-preview-1440x1000.png`, `dossier-preview-1920x1080.png`,
`scene-vue-ensemble-{architecture-sauvegardes,sequence-bout-en-bout,mise-en-service}.png`,
`scene-1a1-{architecture-sauvegardes,sequence-bout-en-bout,mise-en-service}.png`.

Ouvrir cette page n'exécute rien : aucune fusion de PR, aucun provisionnement,
aucun déploiement, aucune sauvegarde ni restauration, aucune action cluster ou
OVH, aucun événement track.
