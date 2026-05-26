# SPEC_EVOL — Process e2e, états, scoring & matérialisation (SOCLE)

> **Status**: EVOL — socle des intentions, à raffiner puis replanifier en évolutions.
> **Issu du brainstorming** 2026-05-26.
> **Inputs**: `docs/spec/input/{VISION,PROMPT,PROCESS}.md` ; acquis : benchmark
> multi-agents (`SPEC_EVOL_DEMO_FINDINGS*`), vertical-slice réel
> (`SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md`, `SPEC_EVOL_DATA_MODEL.md`).
> **But de ce doc**: figer la logique continue (états + traitements + scoring) et
> la stratégie « démo = préfiguration fidèle », puis servir de base à la
> replanification du `PLAN.md`.

## 1. Principe : une logique continue, démo fidèle

Le radar détecte la densification **avant le marché** (VISION §1/§3). La donnée
circule en continu : amorçage → veille récurrente → approfondissement à la demande.
La **démo** ne mélange plus les états : elle **simule fidèlement** ce que produira
le vrai process, avec un **toggle Réel ↔ Simulation par vue** et un étiquetage
honnête des hypothèses.

## 2. Traitements T0→T4 (chacun = un écran)

| T | Traitement | Cadence | Écran | Sortie |
| - | ---------- | ------- | ----- | ------ |
| **T0** | Onboarding ville + **proposition de sources** + rétroanalyse 2 ans | 1×/ville | Assistant onboarding | config ville, corpus initial, 1ᵉʳˢ signaux |
| **T1** | Veille : détection des signaux | quotidien | **Radar** | signal + **score brut** + **statut** + date |
| **T2** | Approfondissement : signal → **N opportunités** | à la demande + auto | **Opportunités** | dossiers (lots) + score pondéré (incrémental) |
| **T3** | **Gestion & qualification des sources** : cadence veille, nouvelles sources, réconciliation, **config jobs scraping** — 2 sous-vues (catalogue · config veille/jobs) | récurrent | **Sources (console)** | sources actives, jobs configurés |
| **T4** | **Monitoring des jobs** | continu | **Jobs** | état run / échec / planifié |

La « Revue des sources » actuelle (cadran) devient le socle de **T3**.

## 3. Cycle de vie d'une opportunité

`Signal détecté (T1, statut + score brut)` → *[auto-enrichissement]* →
**N opportunités (T2)** → *qualif manuelle/assistée* → `Approfondi (score pondéré final)`
→ action. (États terminaux possibles : `Écarté`, `Surveillance`.)

- **Upstream/downstream** : 1 signal (upstream) → **N opportunités/dossiers** (downstream).
- **Statut de signal (T1)** : `nouveau` · `à approfondir` · `écarté` · `surveillance`, horodaté.
- **Score affiché à chaque étape**, qui se précise : `brut` → `provisoire (auto)` → `final (qualifié)`.

## 4. Scoring — deux couches + grilles configurables

### 4.1 Constat
Aujourd'hui le score est produit **par le LLM sans grille explicite** (pifométrique).
PROCESS §3 définit les **axes + poids + lecture opérationnelle**, mais **PAS la
grille 1→5 par axe** → **gap à combler**. On définit donc des grilles explicites,
**configurables**, tracées VISION/PROCESS.

### 4.2 Couche A — Score brut de signal (T1) — VISION §6 (par type)
| Type de signal | Score brut |
| --- | --- |
| Changement de zonage résidentiel (densité/hauteur/conversion/multifamilial) | 10/10 |
| Demande CPTAQ (dézonage agricole) | 8/10 |
| PPCMOI | 7/10 |
| Dérogation mineure pertinente (densité/hauteur/marges/stationnement/usages) | 5/10 |
| Dérogation mineure non pertinente (cabanon, clôture) — à filtrer | 1/10 |
Multiplié par la **confiance de détection** (0–1). → score brut affiché en T1.

### 4.3 Couche B — Score pondéré d'opportunité (T2) — PROCESS §3
Pondérations : **potentiel 30 % · risque 20 % · timing 20 % · faisabilité 15 % · marché 15 %**.
Grille 1→5 **proposée** par axe (configurable, chaque score = niveau + preuve) :

**Potentiel réglementaire** (30 %)
- 1 aucun changement favorable / usage figé · 2 signal indirect / intention floue ·
  3 changement en cours (en attente) ouvrant le résidentiel · 4 changement adopté
  ouvrant densité/usage (conditionnel) · 5 densité résidentielle fortement accrue,
  en vigueur, alignée aux intentions municipales.

**Risque de contrainte** (20 %, *inversé : 5 = peu de risque*)
- 1 bloquant (CPTAQ active / inondable 0–20 ans / contamination) · 2 contrainte
  coûteuse majeure (bande riveraine, servitude lourde) · 3 négociable / mitigation ·
  4 mineure / informative · 5 aucune contrainte majeure.

**Timing** (20 %)
- 1 aucun catalyseur / horizon >10 ans · 2 horizon long, signal faible ·
  3 processus en cours (consultation/référendaire) · 4 fenêtre proche (adoption
  imminente / investissement annoncé) · 5 fenêtre ouverte + marché pas au courant.

**Faisabilité foncière** (15 %)
- 1 inexploitable (trop petit/enclavé/multipropriété) · 2 assemblage lourd requis ·
  3 développable avec assemblage modéré · 4 lot développable, accès/services OK ·
  5 grand lot vacant/sous-utilisé, services en place, propriétaire unique.

**Valeur marché** (15 %)
- 1 marché atone · 2 demande faible · 3 marché actif, comparables corrects ·
  4 forte demande, faible vacance, écart valeur favorable · 5 pénurie + écart fort
  + absorption rapide.

`score pondéré = Σ(niveau_axe × poids)` (résultat /5, affichable /100). L'écart
brut→pondéré (ex. 90→63) **s'explique par les contraintes/faisabilité/marché**
intégrées.

### 4.4 Vue « Grilles de score » (configurable) + hover
- Un écran **Grilles de score** : par axe → poids (éditable) + descriptions 1→5
  (éditables) + traçabilité VISION/PROCESS. Versionné.
- Dans les vues opportunité : **chaque score affiche au survol une mini-grille
  jolie** (les 5 niveaux, niveau courant surligné) + la **justification + preuve**
  de ce niveau (anti-pifométrie : on voit pourquoi 3/5).

## 5. Auto vs humain + assistant (flow agentique)

- **Split par phase** (à matérialiser, tag `{auto-only | assisté | décision-humaine}`) :
  - *auto-only* (non opérable par l'humain à l'échelle) : intersections géospatiales,
    parsing rôle 27 Mo, scan massif PDF/vidéos.
  - *assisté* : ancrage foncier, extraction réglementaire, marché.
  - *décision-humaine* : interprétation réglementaire fine, servitudes/juridique,
    registre foncier payant, go/no-go.
- **Assistant par étape** : contextuel, **proactif** — suit les actions, propose
  l'aide, prépare la tâche humaine, signale ce qui manque.
- **Flow agentique = `@sentropic/flow`** : l'assistant, les agents de veille (T1),
  l'auto-enrichissement et l'orchestration de l'approfondissement (T2) reposent sur
  `@sentropic/flow` (réutilisation écosystème, comme `@sentropic/chat-core`/`llm-mesh`).
- **Chat UI** : **panneau latéral / popup global persistant** entre les vues (modèle
  `../sentropic` chat-ui), pas un panneau par vue → sessions conservées.

## 6. Réel ↔ Simulation (démo fidèle)

- **Toggle par vue** : `données réelles collectées` ↔ `simulation`. Le réel s'appuie
  sur ce qui a été réellement collecté (vertical-slice : rôle, géospatial, avis…).
- **Honnêteté** : toute étape simulée porte le label **« instruit par l'humain ·
  hypothèse simulée »**. Aucune donnée inventée présentée comme un fait (règle
  absolue anti-triche, `rules/MASTER.md`).

## 7. Automatisation (par phases)

| Voie | Maintenant | Cible |
| --- | --- | --- |
| (a) Refresh piloté par prompt (agent rejoue le prompt par source) | **oui, prouvé** | sources « dures » (PDF/PV/YouTube) |
| (b) Jobs planifiés + ETL (configurés en T3, monitorés T4) | sources stables (Données Québec/permis/géo) | open-data robuste |
| (c) Connecteurs MCP par source + agents de veille (`@sentropic/flow`) | moyen terme | interface agent-native |

## 8. Benchmark des prompts ↔ étapes (point conservé)

- Décliner le benchmark **par étape** : quel modèle pour la détection (T1),
  l'extraction/ancrage (T2), le scoring — plutôt qu'un score global unique.
- **Approfondir le résultat du benchmark** : documenter *comment* la comparaison a
  été faite (agent scorer indépendant, métriques M1–M7 gelées, référentiel vérifié)
  + **le takeaway par prompt** (Opus large/traçable ; Codex étroit mais lots réels ;
  Humain exhaustif mais tronqué ; Gemini fabrique). À intégrer à la vue Comparaison.

## 9. Décomposition en évolutions (entrée de replanification)

Trop large pour un seul lot → sous-specs/branches candidates (ordre indicatif) :
1. **Socle modèle + scoring** : modèle d'états (signal→N opp, statuts, score
   incrémental) en `@radar/domain` + **grilles 1→5 configurables** + vue Grilles +
   hover détail. *(fondation, tout en dépend)*
2. **Radar T1** : feed de signaux + statuts + score brut + lien « Approfondir ».
3. **Opportunités T2** : signal→N opportunités, funnel progressif (tags auto/humain),
   score incrémental, réel/simulation.
4. **Chat global `@sentropic/flow`** : assistant latéral persistant + proactif.
5. **Sources console T3** (2 sous-vues) + **Jobs T4**.
6. **Onboarding T0** (proposition de sources, rétroanalyse).
7. **Automatisation** (a→b→c) + **benchmark par étape**.

## 10. Défini vs gap (pour lever les ambiguïtés)

- **Défini** (inputs) : mission/types/priorités (VISION), pipeline 6 phases +
  axes/poids de scoring + gouvernance (PROCESS).
- **Gap à définir ici** : grille 1→5 par axe (§4.3, proposée) ; split auto/humain
  par phase ; rôle de l'assistant ; modèle d'états signal↔opportunités ; toggle
  réel/simulation ; archi d'automatisation.
