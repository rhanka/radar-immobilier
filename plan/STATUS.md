# STATUS — progress oriented by purpose (finalité) × branch

> Conductor-maintained. Mechanical per-branch numbers come from
> `make conductor-report`; the purpose mapping below is editorial and is kept in
> sync at each branch open/close. Last update: 2026-05-25.

## A) Progress by purpose (finalité)

Purposes are derived from `docs/spec/input/VISION.md` and the user's stated
demands (proposal-grade demo, justified sources, end-to-end radar, stable
environments).

| # | Finalité (purpose) | Branches | Status | What's left |
| - | ------------------ | -------- | ------ | ----------- |
| F1 | **Proposition / démo client** (Phase 1 pricing leverage) | BR-05R, BR-11, BR-12 | 🟡 démarré | source-value screen (BR-05R UAT), puis storyboard démo (BR-11) + pack pricing (BR-12) |
| F2 | **Sources : faisabilité, valeur & justification** | BR-05 ✅, BR-05R 🟡 | 🟡 en cours | corrections UAT round 1 (matrice tracée VISION, insights réels, FR, acronymes inline) |
| F3 | **Socle technique** (API, UI, DS, CI, infra) | BR-00..03 ✅, CI-FIX/CI-FIX2 ✅, BR-04 🔄 | 🟢 quasi | merge BR-04 (k8s tenant, PR #8 + #12) |
| F4 | **Pipeline radar end-to-end** (scrape→extract→score→opportunité) | BR-06, BR-07, BR-08 | ⏳ à venir | data-model (BR-06) → vertical slice avis publics (BR-07) → graphify (BR-08) |
| F5 | **Expérience produit** (auth, carte, chat) | BR-09, BR-10, BR-11 | ⏳ à venir | dépend de BR-07 |
| F6 | **Orchestration & environnements** (UAT stable, multi-agent, reporting) | CONDUCTOR | 🟢 livré | merge de la branche chore |

## B) Demandes UAT round 1 (BR-05R) — tracker

Source: `docs/spec/SPEC_EVOL_SOURCE_VALUE_REVIEW.md` §6. Captured = écrit dans le
backlog ; Done = appliqué dans l'UI/data et validé en UAT.

| ID | Demande | Captured | Done |
| -- | ------- | :------: | :--: |
| UAT1-01 | Qualité visuelle (écran buggé → polish, check impeccable) | ✅ | ☐ |
| UAT1-02 | Acronymes : tooltip sur le mot, partout, souligné pointillé + glossaire bas | ✅ | ☐ |
| UAT1-03 | Tout en français (bilingue = chantier ultérieur) | ✅ | ☐ |
| UAT1-04 | Liens de référence dans chaque définition d'acronyme | ✅ | ☐ |
| UAT1-05 | Matrice notée 1→5 par axe + sens + justif, tracée à VISION.md | ✅ | ☐ |
| UAT1-06 | Insights réels par source (capacité à convaincre) | ✅ | ☐ |
| ENV | UAT sur ports racine fixes (5301), data stable | ✅ | 🟢 (règle + tooling livrés ; bascule BR-05R au prochain run) |

## C) Mechanical report (live)

```
make conductor-report                     # reads .agents/lanes
make conductor-report CONDUCTOR_LANES="BR05R|opus|tmp/feat-source-value-review-ui"
```

Snapshot 2026-05-25 09:41 (done %, UAT lots excluded):

```
lane       | agent | branch                          | done        | head
CONDUCTOR  | opus  | chore/uat-env-conductor         | 19/26 (73%) | 982c476
BR05R      | opus  | feat/source-value-review-ui     | 28/35 (80%) | d54e43c
BR04       | gpt   | feat/k8s-tenant-radar-and-infra | 30/38 (79%) | d049e2c
```

## D) Lane assignment — conductor proposal (user decides)

| lane | proposed agent | rationale |
| ---- | -------------- | --------- |
| CONDUCTOR | **opus** (Claude Opus 4.7) | orchestration, rules, reporting (current) |
| BR05R | **opus** (Claude Opus 4.7) | UI/design taste, careful FR copy, scoring matrix judgment, VISION traceability |
| BR04 | **gpt** (GPT-5.5 xhigh) | systematic infra/k8s/YAML closeout (PR #8 + #12) |
| BR06+ (next greenfield: data-model / sources) | **gemini** (Gemini 3.5 high) | reserve for the next data/sources lane when scheduled |

To override, edit the `agent` column in `.agents/lanes`.
