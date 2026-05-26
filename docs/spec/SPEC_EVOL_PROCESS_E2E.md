# SPEC_EVOL — Process e2e, états, scoring & matérialisation (SOCLE v2)

> **Status**: EVOL v2 — intègre les relectures-challenge **agy (Gemini)** + **Claude
> Opus 4.7** (2026-05-26, critiques dans `tmp/socle-reviews/`).
> **Inputs**: `docs/spec/input/{VISION,PROMPT,PROCESS}.md`. **Acquis réels**:
> `SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md`, `SPEC_EVOL_DATA_MODEL.md`,
> `SPEC_EVOL_DEMO_FINDINGS.md`.
> **But**: figer la logique continue (états + traitements + scoring **confronté au
> réel**) et la stratégie « démo = préfiguration fidèle », base de replanification.

## 1. Principe
Détecter la densification **avant le marché** (VISION §1/§3). Flux continu :
amorçage → veille → approfondissement. La démo **simule fidèlement** le process,
avec un **mode global Réel ↔ Simulation** (§6) et un étiquetage honnête des
hypothèses (règle anti-triche, `rules/MASTER.md`). **Rien d'inventé.**

## 2. Traitements T0→T4 ↔ 6 phases PROCESS

| T | Traitement | Phases PROCESS couvertes | Cadence | Écran(s) |
| - | ---------- | ------------------------ | ------- | -------- |
| T0 | Onboarding ville + proposition de sources (template Tier-A fixe + découverte site) + rétroanalyse 2 ans | amont (sourcing) | 1×/ville | Assistant onboarding |
| T1 | Veille : détection signaux | **Ph.1 Signal** | quotidien | Radar |
| T2 | Approfondissement : signal → N opportunités | **Ph.2 Ancrage · 3 Contraintes · 4 Marché · 5 Contexte stratégique · 6 Scoring** | à la demande + auto | Opportunités |
| T3 | Gestion & qualification des sources (cadence, nouvelles sources, réconciliation, config jobs) | transverse sourcing | récurrent | Sources (2 sous-vues) |
| T4 | Monitoring des jobs | transverse exécution | continu | Jobs |

> Le mapping « T ↔ écran » est indicatif (T3 a 2 sous-vues ; le cycle de vie §3
> chevauche T1+T2). **Phase 5 « Contexte stratégique » (StatCan/transport/MRC,
> catalyseurs)** est portée par T2 — explicitée ici car diluée en v1.

## 3. Modèle d'états (enrichi)

- **Cardinalité** : 1 **signal** (amont, T1) → **N opportunités/dossiers** (aval, T2).
  Pour éviter la saturation (un rezonage = des centaines de lots), **pré-filtres
  physiques avant création des dossiers T2** : superficie lot ≥ seuil (déf. 350 m²),
  ratio valeur bâtiment/terrain < seuil (déf. 80 %), exclure les micro-lots bâtis
  récents. Seuils configurables.
- **Lots** : ajouter `confirmed: boolean` (lot lié par proximité d'adresse = `false`
  / intersection géométrique validée = `true`) et `zonePolygonSource:
  open-data-ckan | wms-municipal | vectorised-pdf | hypothese-street-name`.
- **Statut de signal (T1)** : `nouveau · à approfondir · écarté · surveillance`, horodaté.
- **Taxonomie d'actions (PROCESS §6, complète)** : `rejeter · surveiller ·
  qualifier-avec-expert · approcher-propriétaire · monter-dossier-acquisition`.
- **Mémoire temporelle (VISION §4.2/§4.5/§7)** : un dossier **évolue sur plusieurs
  séances** (timeline d'événements horodatés) ; la rétroanalyse 2 ans alimente cette
  timeline, pas seulement T0.
- **Liaison de documents (VISION §4.4/§7)** : relier avis ↔ règlement ↔ PV ↔ vidéo
  par **n° de règlement / zone**, pour reconstruire le contexte.
- **Provenance par donnée** : enum `fait · hypothese · non-disponible · simulé`
  (le `simulé` = « instruit par l'humain · hypothèse simulée », cf. §6).

## 4. Scoring — DEUX mesures distinctes, confrontées au réel

### 4.1 Sémantique (correction n°1 des relectures)
Il y a **deux scores différents, pas un seul qui se raffine** :
- **Tri de signal (T1)** = *prior de triage par type* (VISION §6). Échelle /10.
- **Score d'opportunité (T2)** = *composite multi-axes* (PROCESS §3). Échelle 0-5 (→ /100).

⚠️ **Abandon du récit trompeur « 90 → 63 / brut→provisoire→final comme un seul
score »**. La vraie histoire : le tri T1 remonte un signal « chaud par type » ; la
qualification T2 produit un score d'opportunité **ancré au réel**, souvent plus
modeste une fois contraintes/faisabilité/marché intégrés. Deux mesures, deux usages.

### 4.2 Tri de signal (T1) — VISION §6
- **Valeur** (type) **et confiance affichées séparément** (NE PAS multiplier — sinon
  on enterre les signaux « haute valeur / incertaine » qu'on veut justement remonter).
- Table type → valeur : zonage résidentiel 10 · CPTAQ 8 · PPCMOI 7 · dérogation
  pertinente 5 · dérogation non pertinente 1 (à filtrer). **Types à ajouter** :
  intention politique (PV), consultation publique annoncée, refonte/plan d'urbanisme,
  modif. grille/COS, requalification/TOD, investissement public. (Résout l'ambiguïté
  interne VISION §6 « Priorité 2 PPCMOI 7 » vs « Priorité 4 CPTAQ 8 » : **on tranche
  par le score**, CPTAQ 8 > PPCMOI 7.)

### 4.3 Score d'opportunité (T2) — PROCESS §3, échelle **0-5**, poids 30/20/20/15/15
*(0-5 et non 1-5 : le 0 = blocage/absence absolus, PROCESS §3/§6.)* Grilles
configurables ; chaque score porte **niveau + confiance + preuve + version de grille**.

- **Potentiel (30 %) — AMPLEUR seule** (pas la maturité légale, qui est dans Timing →
  fin du double-comptage) : 0 aucune ouverture · 2 ouverture mineure · 3 ouverture
  résidentielle modérée · 4 forte (densité/usage nettement accrus) · 5 majeure +
  alignée aux intentions municipales. **« en vigueur » retiré du niveau 5** (anti-
  asymétrie VISION : la meilleure perle est encore peu visible).
- **Risque de contrainte (20 %, inversé)** : 0 **bloquant absolu** (zone agricole
  **protégée pérenne sans demande** / inondable 0-20 ans / contamination) · 2 coûteux
  majeur · 3 négociable/mitigation · 4 mineur · 5 aucune contrainte. **CPTAQ
  désambiguïsé** : zone protégée *sans demande* = bas ; **demande/décision de
  dézonage en cours = risque moindre + signal positif** (réconcilie le paradoxe avec
  §4.2). **« non-intersecté / indéterminé » ≠ 5** → marqué **non-disponible** (§4.4).
- **Timing (20 %)** : séparer **horizon** (long ≠ mauvais — VISION §9 vise le
  structurel long terme) et **visibilité concurrentielle**. 0 aucun catalyseur ·
  3 processus en cours (consultation/référendaire) · 5 fenêtre ouverte **+ visibilité
  faible mesurée** (proxy : aucune transaction notariée récente depuis le 1ᵉʳ projet
  — **Tier C → souvent non-disponible**, marqué hypothèse).
- **Faisabilité foncière (15 %)** : forme/accès/superficie/assemblage. Niveaux liés au
  **propriétaire = hypothèse** (caviardé, LFM art. 72 — `confirmed:false`) ; « services
  aqueduc/égout » = à sourcer (pas garanti en open-data).
- **Valeur marché (15 %)** : comparables/permis/absorption = **Tier C → non-disponible
  par défaut** ; **ne pas fabriquer** ; à défaut, **plafonner la recommandation à
  « surveillance »** (PROCESS §3).

### 4.4 Traitement « non-disponible » (le trou comblé)
Un axe non-disponible : **renormaliser les poids sur les axes disponibles**, marquer
le score **partiel**, et **plafonner la recommandation à « surveillance »** si une
preuve clé manque (PROCESS §3 « score élevé sans preuve récente → surveillance »).
**Jamais** de valeur neutre fabriquée. Inconnu ≠ favorable.

### 4.5 Vue « Grilles de score » (configurable) + hover
Écran : par axe → poids + descriptions 0-5 **éditables**, tracés VISION/PROCESS,
**versionnés**. Chaque score (vues opportunité) affiche au survol une **mini-grille**
(0-5, niveau courant surligné) + **justification + preuve + confiance + version**.
**Versioning** : scores passés **gelés** sous leur version de grille ; recalcul **à la
demande** (pas rétroactif automatique).

### 4.6 Calibration sur les 3 pilotes réels (avant de figer)
Valider les grilles contre **H-609-4 / U-521→H-521 / H-143** (dossiers existants) :
beaucoup d'axes seront **non-disponibles** (Marché Tier C, propriétaire LFM 72, Risque
gap polygone) → scores **partiels + plafond surveillance**, ce qui est le résultat
honnête attendu. Tableau de calibration à produire dans l'évolution 1.

## 5. Auto/humain + assistant + flow agentique
- **Split par phase** `{auto-only | assisté | décision-humaine}` : auto-only
  (intersections géo, parsing rôle 27 Mo, scan PDF/vidéos) ; assisté (ancrage,
  extraction réglementaire, marché) ; décision-humaine (interprétation réglementaire,
  servitudes/juridique, registre foncier payant, go/no-go).
- **Assistant** contextuel proactif (suit les actions, propose l'aide, prépare la
  tâche humaine, signale les manques).
- **`@sentropic/flow`** = **couche agentique cible** (assistant, agents de veille T1,
  auto-enrichissement, orchestration T2). **Spike de validation d'abord** ; **le socle
  (modèle + grilles + Radar + Opportunités) n'en dépend PAS** (un agent 0-shot suffit,
  cf. DEMO_FINDINGS).
- **Chat UI** : panneau latéral/popup **global persistant** (modèle `../sentropic`) —
  retenu, mais **séquencé après le socle**.

## 6. Réel ↔ Simulation — mode GLOBAL (révisé)
- **Mode global** (header) `Réel ↔ Simulation`, **pas un toggle par vue** (les 2
  relecteurs : sur-ingénierie, risque de datasets divergents).
- La simulation est un **état de la donnée** (provenance par item `simulé`, §3), pas
  un swap de datasets. Le réel s'appuie sur ce qui a été réellement collecté
  (vertical-slice).
- **Honnêteté** : tout item simulé porte le label « instruit par l'humain · hypothèse
  simulée ». Aucun simulé présenté comme fait.

## 7. Automatisation (par phases) + clarification cron vs agent
| Voie | Maintenant | Mécanisme |
| --- | --- | --- |
| (a) Replay par prompt (agent rejoue PROMPT.md/source) | **prouvé** (DEMO_FINDINGS) | agent `@sentropic/flow` à terme ; pour sources « dures » (PDF/PV/YouTube) |
| (b) Jobs planifiés + ETL | sources stables (Données Québec/CKAN/permis/géo) | **cron/scraping classique** ; c'est ce que **T4 monitore** |
| (c) Connecteurs MCP par source | différé (YAGNI) | interface agent-native long terme |
> Frontière : (b) = tâches planifiées déterministes (T4) ; (a) = exécution d'agent sur
> sources non structurées. YouTube (VISION §4.3) reste fragile (captions/whisper) →
> Tier-B, à intégrer en T3, non bloquant.

## 8. Benchmark des prompts ↔ étapes (conservé)
Décliner le benchmark **par étape** (détection T1 / extraction-ancrage T2 / scoring)
plutôt qu'un score global ; **documenter la méthode** (scorer indépendant, M1-M7
gelées, référentiel vérifié) + **takeaway par prompt** (Opus large/traçable ; Codex
étroit mais lots réels ; Humain exhaustif mais tronqué ; Gemini fabrique). À intégrer
à la vue Comparaison.

## 9. Décomposition révisée (socle réduit) — entrée de replanification
> Les 3 pilotes ont **déjà de la donnée réelle** (vertical-slice) → Radar/Opportunités
> testables en réel **sans** construire T0 d'abord (lève la contradiction d'ordre).

1. **Socle (évolution 1, fondation)** : modèle d'états (signal→N opp + `confirmed` +
   `zonePolygonSource` + pré-filtres) + **grilles 0-5 corrigées + traitement
   non-disponible** + vue Grilles + hover + **calibration sur les 3 pilotes**.
2. **Radar T1** : feed signaux + statuts + tri (valeur/confiance séparés) + « Approfondir ».
3. **Opportunités T2** : signal→N opportunités, funnel progressif (tags auto/humain),
   score d'opportunité, **mode global réel/simulé**, mémoire multi-séances.
4. **T0 onboarding** (proposition de sources, rétroanalyse) — productise l'ingestion.
5. **Chat global `@sentropic/flow`** — après **spike** de validation.
6. **T3 console sources** (2 sous-vues) + **T4 jobs** — quand l'automatisation continue arrive.
7. **Automatisation (a→b)** + **benchmark par étape**.

## 10. Défini vs gap
- **Défini (inputs)** : mission/types/priorités (VISION) ; pipeline 6 phases +
  axes/poids + gouvernance (PROCESS).
- **Défini ici (v2)** : sémantique des 2 scores ; grilles 0-5 corrigées + traitement
  non-disponible ; ancrage réalité données (`confirmed`, `zonePolygonSource`, gaps
  Tier C/LFM 72) ; mode global réel/sim ; mémoire temporelle + liaison docs + actions ;
  socle réduit + ordre.
- **À produire (évolution 1)** : la **calibration chiffrée des grilles sur les 3
  pilotes** ; le spike `@sentropic/flow`.
