# Traçabilité des bugs / retours UX signalés par l'utilisateur

> Établi en relisant les transcripts des 2 sessions (`0007450c` 24/05 + `e0f1d8ab`) croisés avec
> le code de `main`. **Chaque statut est vérifié dans le code**, pas sur la foi des messages de commit.
> ⚠️ **Découverte majeure** : le commit `daa52ff` (« Opportunités master-detail + phases en colonnes +
> 100% design-system ») **n'est PAS dans `main`** — commit orphelin (tag `backup/local-main-divergence-daa52ff`),
> jamais mergé. `main` (`30e8b09`) garde l'**ancien layout empilé** d'Opportunités. Donc **R2/R3/S3-A
> ne sont PAS résolus dans le code livré** malgré l'apparence du `git log`.

## Table de traçabilité

| # | Quand | Bug signalé (verbatim court) | Statut | Preuve | Reste à faire |
|---|---|---|---|---|---|
| 1 | S1 BR-05R | « c assez bugué » (vue qualif) | ❔ À RE-VÉRIFIER | source-review refondue en tab Console (`3c86b83`) | UAT sur nouvelle Console |
| 2 | S1 BR-05R | Acronymes : hover sur chaque acronyme, partout | ✅ RÉSOLU | `b65af64` composant `Acronym` + glossaire 12 termes, câblé Signaux/Grilles/Console | — |
| 3 | S1 BR-05R | Tout en français | ❔ À RE-VÉRIFIER | UI actuelle FR | Vérif glossaire restant |
| 4 | S1 BR-05R | Liens de réf dans descriptions d'acronyme | ✅ RÉSOLU | `b65af64` glossaire avec `url` (CPTAQ, OACIQ…) affiché dans le hover | — |
| 5 | S1 BR-05R | Matrice score 1/5..5/5 + traçabilité VISION (comme sentropic) | ✅ RÉSOLU | grilles 0-5 + rationale + `ScoreHover` ; **réf VISION §6 / PROCESS Étape 5 affichée dans Grilles** (`5b5cb1f`) | — |
| 6 | S1 BR-05R | Insights réels par source (faisceau de preuve) + liens | 🟡 PARTIEL | preuves par phase + lien Source + badge fait/hypothèse/N-D | Vue « valorisation par source » absente |
| 7 | S1 | Story-telling / bulle jaune au 1ᵉ passage | 🟡 PARTIEL | tour 24 étapes jamais mergé ; bulle dual-tri seule (`fa9dcf6`) | Tour guidé complet absent de main |
| 8 | S1 | « je ne vois aucune bulle jaune » | ✅ RÉSOLU | bulle d'aide `SignalsT1View` | — |
| 9 | S1 | Radar↔Opportunité côte à côte, clic mène à l'autre | 🟡 PARTIEL | nav latérale ; Approfondir→Opportunités filtrée | Pas de côte-à-côte (Radar supprimé, en partie caduc) |
| 10 | S1 | « opportunités au pluriel » | ✅ RÉSOLU | `AppSidebar` label "Opportunités" | — |
| 11 | S1 | Tous signaux → 1 opportunité @ 90 (bug) | ✅ RÉSOLU | plus de "90" ; mapping 1→N via `signalId` | — |
| 12 | S1 | « marge droite de folie » | ✅ RÉSOLU | cap `max-w` retiré | — |
| 13 | S1 | Onglets navigables / push GitHub | ✅ RÉSOLU | nav AppSidebar ; tout mergé | — |
| G1 | S2 | Jargon T0/T1/T3/T4 | ✅ RÉSOLU | `ff84484`, `8446450` | — |
| ON1 | S2 | Onboarding sans choix de ville | ✅ RÉSOLU | `e3c7cb2` Select municipalité QC | — |
| ON2 | S2 | « Construire/Qualifier l'accès » imbitable, cocher = rien | ✅ RÉSOLU | `OnboardingView` Switch + récap live | — |
| RA1 | S2 | Signaux → 1 opp @ 90 non-conforme | ✅ RÉSOLU | ancien Radar supprimé `8446450` | — |
| RA2/CH1 | S2 | Chat global side-panel/détachable (comme sentropic) | ⏳ DIFFÉRÉ →ÉV9 | `RadarChatPanel` présent mais non câblé | Implémenter chat-ui dans le layout |
| RA3 | S2 | Supprimer Radar | ✅ RÉSOLU | Signaux = feed unique | — |
| SI1 | S2 | 6 signaux en données, 3 affichés | ✅ RÉSOLU | `fa9dcf6` 6 affichés | — |
| SI2 | S2 | « signaux hypothétiques » confus | ✅ RÉSOLU | badge « Exemple (simulation) » | — |
| SI3 | S2 | Signaux vs Radar | ✅ RÉSOLU | fusion | — |
| SI4 | S2 | Pas de score visible | ✅ RÉSOLU | Valeur /10 + Confiance explicites ; dérogation affiche « Filtre (pas de score) » `5b5cb1f` | — |
| CMP1 | S2 | Comparaison toujours là, critères M1-M7 non expliqués | ✅ RÉSOLU | `0c20122` fondue dans Automatisation | — |
| SRC1 | S2 | Revue sources : activation incomprise | ✅ RÉSOLU | tab « Cadran sources » Console `828b59b` | — |
| OP1 | S2 | Réel/sim : aucune différence | ✅ RÉSOLU | `e6d2f86` axesForMode (réel exclut hypothèses + plafonne) | — |
| GR1 | S2 | Grilles moches + illisibles | ✅ RÉSOLU | `0c7dbe9` 2 tabs (/10 vs /100) + grille par axe | — |
| H2A1 | S2 | h2a hors-sol | ⏳ DIFFÉRÉ →ÉV10 | stub Coordination retiré du nav | Implémenter h2a API |
| CO1 | S2 | « T3/T4 » abscons | ✅ RÉSOLU | copy sans T3/T4 | — |
| CO2 | S2 | Rien cliquable | ✅ RÉSOLU | `828b59b` Drawer détail source/job | — |
| S3-A | S3 | Interfaces flat, mono-colonne | ✅ RÉSOLU | app-shell dense (`3c86b83`) + **Opportunités master-detail** (`ac6c862`) | — |
| S3-B1 | S3 | Redondance cadran ↔ console | ✅ RÉSOLU | cadran **fusionné dans Qualification**, tab séparé retiré `5b5cb1f` | — |
| S3-B2 | S3 | Redondance rapport agents | ✅ RÉSOLU | fondue dans Automatisation | — |
| S3-C | S3 | Rien d'automatisé/live | ⏳ DIFFÉRÉ →ÉV11 | AutomationView = stub | Agent PROMPT.md + Tavily + flow |
| R1 | S3 | « je vois encore T0 » | ✅ RÉSOLU | `ff84484` strip complet | — |
| R2 | S3 | Opportunités empilées ; sélection/accordéon ; ≥2 colonnes par sous-élément | ✅ RÉSOLU | **réimplémenté sur main** : master-detail `grid-cols-12` + phases `grid-cols-2` (`ac6c862`) | — |
| R3 | S3 | « 100% design system » | ✅ RÉSOLU | Opportunités passées en DS (Card/Badge/Alert) `ac6c862` ; DS-lint 0 partout | — |
| R4 | S3 | « du non-réel dans le réel » | 🟡 PARTIEL | axesForMode exclut hypothèses | À reconfirmer en UAT |
| R5 | S3 | « pas démarré » / « aucune différence sur :5301 » | ✅ RÉSOLU (process) | mauvais worktree/branche bind-montés | — |

## Synthèse (28 items distincts) — après lot `feat/uat-fixes`
- ✅ RÉSOLU : **24** (dont R2/R3/S3-A réimplémentés `ac6c862`, #2/#4 acronymes `b65af64`, SI4/#5/S3-B1 `5b5cb1f`)
- ⏳ DIFFÉRÉ (évolutions convenues, pas des bugs) : 3 — RA2/CH1 chat→ÉV9, H2A1 h2a→ÉV10, S3-C live→ÉV11
- 🟡 PARTIEL restant : 2 — **#6** (vue « valorisation par source » / faisceau dédiée — non construite), **#9** (Radar↔Opp côte-à-côte — en partie caduc, Radar supprimé)
- ❔/⏳ feature non mergée : **#7** (tour guidé 24 étapes — jamais mergé ; bulle d'aide ponctuelle présente)
- ❔ À RE-VÉRIFIER : #1, #3 (anciennes vues de qualif refondues en Console)

### Reste réellement à faire (non clos, explicite)
- **#6** — vue dédiée « valorisation de chaque source dans le faisceau de preuves » (les preuves par phase existent, mais pas la vue d'analyse de contribution par source).
- **#7** — tour guidé complet (storytelling) : était sur `feat/demo-guided-tour`, jamais mergé.
- **#9** — affichage côte-à-côte Radar/Opportunités : en grande partie caduc (Radar supprimé) ; reste l'enchaînement Approfondir→Opportunités.
- **ÉV9 / ÉV10 / ÉV11** — chat réel, h2a, pipelines live : évolutions de la roadmap (spec §11/§12), pas des bugs.
