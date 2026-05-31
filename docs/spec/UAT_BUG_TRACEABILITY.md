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
| 2 | S1 BR-05R | Acronymes : hover sur chaque acronyme, partout | ❌ NON TRAITÉ | seul `CriteriaGlossary` (glossaire critères, partiel) | Composant acronyme hover page-wide |
| 3 | S1 BR-05R | Tout en français | ❔ À RE-VÉRIFIER | UI actuelle FR | Vérif glossaire restant |
| 4 | S1 BR-05R | Liens de réf dans descriptions d'acronyme | ❌ NON TRAITÉ | absent | Ajouter liens sources |
| 5 | S1 BR-05R | Matrice score 1/5..5/5 + traçabilité VISION (comme sentropic) | 🟡 PARTIEL | grilles 0-5 + rationale + `ScoreHover` (`0c7dbe9`) ; VISION tracée en doc §9 | Pas de backlink VISION dans le hover UI |
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
| SI4 | S2 | Pas de score visible | ✅ RÉSOLU | Valeur /10 + Confiance explicites | Résiduel : signal dérogation porte encore `value:5` (vs S1.2 « filtre pur ») |
| CMP1 | S2 | Comparaison toujours là, critères M1-M7 non expliqués | ✅ RÉSOLU | `0c20122` fondue dans Automatisation | — |
| SRC1 | S2 | Revue sources : activation incomprise | ✅ RÉSOLU | tab « Cadran sources » Console `828b59b` | — |
| OP1 | S2 | Réel/sim : aucune différence | ✅ RÉSOLU | `e6d2f86` axesForMode (réel exclut hypothèses + plafonne) | — |
| GR1 | S2 | Grilles moches + illisibles | ✅ RÉSOLU | `0c7dbe9` 2 tabs (/10 vs /100) + grille par axe | — |
| H2A1 | S2 | h2a hors-sol | ⏳ DIFFÉRÉ →ÉV10 | stub Coordination retiré du nav | Implémenter h2a API |
| CO1 | S2 | « T3/T4 » abscons | ✅ RÉSOLU | copy sans T3/T4 | — |
| CO2 | S2 | Rien cliquable | ✅ RÉSOLU | `828b59b` Drawer détail source/job | — |
| S3-A | S3 | Interfaces flat, mono-colonne | 🟡 PARTIEL | app-shell dense (`3c86b83`) + DS ailleurs | **Opportunités reste mono-colonne** (R2 non mergé) |
| S3-B1 | S3 | Redondance cadran ↔ console | 🟡 PARTIEL | cadran déplacé en tab Console | Cadran + Qualification cohabitent (mêmes données) |
| S3-B2 | S3 | Redondance rapport agents | ✅ RÉSOLU | fondue dans Automatisation | — |
| S3-C | S3 | Rien d'automatisé/live | ⏳ DIFFÉRÉ →ÉV11 | AutomationView = stub | Agent PROMPT.md + Tavily + flow |
| R1 | S3 | « je vois encore T0 » | ✅ RÉSOLU | `ff84484` strip complet | — |
| R2 | S3 | Opportunités empilées ; sélection/accordéon ; ≥2 colonnes par sous-élément | ❌ NON TRAITÉ (dans main) | `OpportunityFunnel` `space-y-8` ; phases `space-y-3` ; master-detail seulement dans `daa52ff` orphelin | **Réimplémenter master-detail + colonnes sur main** |
| R3 | S3 | « 100% design system » | 🟡 PARTIEL | DS répandu ailleurs | DossierCard/OpportunityFunnel encore Tailwind brut |
| R4 | S3 | « du non-réel dans le réel » | 🟡 PARTIEL | axesForMode exclut hypothèses | À reconfirmer en UAT |
| R5 | S3 | « pas démarré » / « aucune différence sur :5301 » | ✅ RÉSOLU (process) | mauvais worktree/branche bind-montés | — |

## Synthèse (28 items distincts)
- ✅ RÉSOLU : 17
- 🟡 PARTIEL : 8 (#5, #6, #7, #9, S3-A, S3-B1, R3, R4 ; + résiduel SI4)
- ⏳ DIFFÉRÉ (assumé spec) : 3 — RA2/CH1→ÉV9, H2A1→ÉV10, S3-C→ÉV11
- ❌ NON TRAITÉ : 3 — #2 (acronymes hover), #4 (liens réf), **R2 (Opportunités master-detail/colonnes)**
- ❔ À RE-VÉRIFIER : 2 — #1, #3 (vues refondues)

**Action n°1** : réimplémenter sur `main` le master-detail Opportunités + phases multi-colonnes + DS
(clôt R2 + S3-A + R3). Le travail existe dans `daa52ff` (tag `backup/local-main-divergence-daa52ff`)
mais basé sur un état ancien → réimplémenter sur le `main` courant plutôt que cherry-pick.
