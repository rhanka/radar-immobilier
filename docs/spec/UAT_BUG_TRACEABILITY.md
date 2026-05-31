# Traçabilité fine des bugs / UX UAT — radar-immobilier

> Vérifiée au code sur la branche `feat/uat-fixes-2` (sur `main` `e50d59c` + correctifs). Grain fin
> (1 ligne par sous-demande), posture **adverse**. Tableau **Problème → Résolution → Statut**.
> Après le lot de clôture des bloquants : **0 ❌, 0 🟡 bloquant** ; ne restent que les 3 évolutions
> convenues (chat ÉV9, h2a ÉV10, live ÉV11) et 1 item caduc.

| Problème (verbatim court) | Résolution (fichier/commit) ou « NON FAIT » | Statut |
|---|---|---|
| [BR-05R] Acronymes : hover sur chaque acronyme, partout | `Acronym` + glossaire 12 termes (`b65af64`) **étendu** à Opportunités/Automatisation/Jobs/Onboarding (`e5d9bad`) | ✅ |
| [BR-05R] Tout en français | défs FR ; « Reference »→« Référence » (`d66d2ca`) | ✅ |
| [BR-05R] Liens de référence dans l'acronyme | `url` dans tooltip (`b65af64`) | ✅ |
| [BR-05R] Matrice score 0-5 + traçabilité VISION | grille par axe + `ScoreHover` + réfs VISION §6 / PROCESS Étape 5 | ✅ |
| [BR-05R] Insights / valorisation par source (faisceau) | **panneau « Contribution » Console** : par source nb dossiers/preuves, phases, mix vérification (`aa15226`) | ✅ |
| [S1] Story-telling / tour multi-étapes par écran | **visite guidée 15 étapes / 6 vues, bulles jaunes, auto-start + relance** (`662f7e8`) | ✅ |
| [S1] « plus d'étapes par écran, expliquer chaque vue » | idem visite guidée (`662f7e8`) | ✅ |
| [S1] « je ne vois aucune bulle jaune » | bulles jaunes (tour + aide Signaux) | ✅ |
| [S1] Radar↔Opportunité côte à côte | **caduc** : Radar supprimé ; enchaînement Approfondir→Opportunités assuré | ❔ caduc |
| [S1] clic l'un → l'autre | Approfondir→Opportunités filtré (`App.svelte`) | ✅ |
| [S1] opportunités au pluriel | label « Opportunités » | ✅ |
| [S1] tous signaux→même opp @90 (bug) | scores /100, signalId distincts | ✅ |
| [S1] marge droite de folie | cap retiré, pleine largeur | ✅ |
| [S1] onglets navigables / push | nav + mergé | ✅ |
| [S2] supprimer T0-T4 | nettoyé (`ff84484`) | ✅ |
| [S2] Onboarding ville QC | Select municipalité, ville visible (`e3c7cb2`) | ✅ |
| [S2] Onboarding UX imbitable + cocher=rien | Switch + bénéfice + récap live (`e3c7cb2`) | ✅ |
| [S2] Radar.1 mapping/@90 non conforme | ancien Radar supprimé (`8446450`) | ✅ |
| [S2] Radar.2 chat side-panel toutes vues | `RadarChatPanel` non monté ; convenu → ÉV9 | ⏳ ÉV9 |
| [S2] Radar à supprimer | retiré | ✅ |
| [S2] Signaux que 3/6 | 6 rendus (`fa9dcf6`) | ✅ |
| [S2] Signaux pas de score | Valeur /10 + Confiance | ✅ |
| [S2] Signaux « hypothétiques » confus | badge « Exemple (simulation) » | ✅ |
| [S2] signaux vs radar | Radar supprimé, fil unique | ✅ |
| [S2] Comparaison ici ? + critères | fondue Automatisation, M1-M7 | ✅ |
| [S2] Revue sources activation | Onboarding + Console | ✅ |
| [S2] Opportunités réel/sim aucune diff | `axesForMode` exclut + plafonne (`e6d2f86`) | ✅ |
| [S2] en réel : hypothèses + **dossier stoppé** | preuves non vérifiées masquées + badge « En attente de preuve » (`d66d2ca`) | ✅ |
| [S2] Grilles moches/illisibles | refonte 2 mesures (`0c7dbe9`) | ✅ |
| [S2] H2a incompréhensible | stub retiré ; convenu → ÉV10 | ⏳ ÉV10 |
| [S2] Console T3/T4 + rien cliquable | FR + Drawer au clic (`828b59b`) | ✅ |
| [S2] scoring↔VISION séance + /100 | figé + headline /100 | ✅ |
| [S3] flat / mono-colonne | app-shell dense + master-detail (`3c86b83`,`ac6c862`) | ✅ |
| [S3] redondance cadran↔console | cadran fusionné Qualification (`5b5cb1f`) | ✅ |
| [S3] redondance rapport agents | fondu Automatisation | ✅ |
| [S3] rien d'automatisé/live | stubs étiquetés ; convenu → ÉV11 | ⏳ ÉV11 |
| [S3] je vois encore T0 | strip complet | ✅ |
| [S3] opportunités empilées : sélection | master-detail (`ac6c862`) | ✅ |
| [S3] sous-éléments ≥2 colonnes | phases `grid-cols-2` | ✅ |
| [S3] 100% design system | **toutes les vues** migrées DS (`e5d9bad`) ; DS-lint 0 | ✅ |
| [S3] « du non-réel dans le réel » | preuves `hypothese`/`non-disponible` grisées « non vérifié » en réel (`d66d2ca`) | ✅ |
| [S3] pas démarré / bonne branche | mauvais worktree monté (process) | ❔ caduc |
| [S3] je vois pas la traçabilité | ce document (grain fin) | ✅ |

## Décompte (43 items) : ✅ 38 · ⏳ 3 (ÉV9 chat / ÉV10 h2a / ÉV11 live) · ❔ 2 (caduc)

## Reste — uniquement les évolutions convenues (PAS des bugs)
- **ÉV9** — chat réel side-panel (`@sentropic/chat-ui` + llm-mesh) accessible de toutes les vues.
- **ÉV10** — h2a réel (journal signé + rôles) côté API.
- **ÉV11** — pipelines live (agent PROMPT.md + Tavily + flow).

Tous les **bugs/UX signalés en UAT sont résolus** (38/43) ; les 2 « caduc » sont l'ancien
côte-à-côte (Radar supprimé) et un incident de process (mauvais worktree monté).
