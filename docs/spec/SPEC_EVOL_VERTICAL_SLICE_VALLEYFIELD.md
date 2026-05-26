# SPEC_EVOL — Vertical slice réel Valleyfield (matérialisation bout-en-bout)

> **Status**: EVOL, design validé 2026-05-25 (brainstorming).
> **Inputs**: `docs/spec/input/{VISION,PROMPT,PROCESS}.md`, le benchmark
> multi-agents (`SPEC_EVOL_DEMO_FINDINGS*`), les spikes BR05
> (`SPEC_EVOL_SOURCE_FEASIBILITY.md`).
> **Avance**: BR-06 (data model sur données réelles) + BR-07 (vertical slice).

## 1. But

Matérialiser, de bout en bout et avec des **données réelles**, l'entonnoir
PROCESS (6 phases) sur **3 opportunités** de Salaberry-de-Valleyfield, en
**priorisant les sources réellement accessibles**. Objectif : rendre lisibles et
concrets (1) la **valeur de chaque source = son rôle dans l'entonnoir / sa
contribution au faisceau de preuve**, (2) le **raffinage** du signal phase par
phase, (3) le **recollement** multi-sources en une fiche opportunité scorée.

## 2. Règle cardinale (héritée VISION/PROCESS + règle anti-triche)

Ne rien inventer. Chaque donnée affichée porte **source (lien exact) + date +
mode d'obtention + niveau de confiance**. Une valeur non obtenue = explicitement
**« Information non disponible »**. Un score sans preuve récente → ramené en
surveillance (PROCESS §3).

## 3. Opportunités pilotes (3, en profondeur)

1. **H-609-4** — règl. 150-49 — nouvelle zone, densité conditionnelle jusqu'à
   50 log/ha (≥30 % boisé conservé + PIIA).
2. **U-521 → H-521** — règl. 150-51 — conversion vers résidentiel, secteur urbain
   central (ancrage foncier plus simple → contraste).
3. **H-143 / H-143-1** — règl. 150-49-1 — Grande-Île, densité conditionnelle,
   proximité zone agricole A-118 (illustre la phase Contraintes / CPTAQ).

## 4. Entonnoir PROCESS appliqué — sources réelles par phase

| Phase | Décision PROCESS | Sources réelles (priorité accessibilité) |
| ----- | ---------------- | ---------------------------------------- |
| 1. Signal réglementaire | assez concret pour ancrer ? | avis publics PDF (Tier A) ; zonage/grilles PDF + PV (Tier B OCR/LLM) ; **YouTube conseil** (transcription, §6) |
| 2. Ancrage foncier | lot réel/localisable ? | **rôle d'évaluation open-data** (XML/GeoJSON, donneesouvertes.affmunqc.net) ; **cadastre allégé** (NO_LOT) ; Adresses Québec — Tier A |
| 3. Contraintes | bloquant / négociable / coûteux ? | **BDZI** inondable ; **GRHQ** hydro ; **CPTAQ** zone agricole — intersections géospatiales réelles (Tier A) |
| 4. Marché | le marché soutient ? | **permis** Données Québec (Tier A) ; transactions/JLR/Centris = **Tier C → manque documenté** |
| 5. Contexte stratégique | asymétrie de timing ? | **StatCan** (démo/revenus) ; transport/MRC — Tier A/B |
| 6. Scoring | acheter/surveiller/qualifier/rejeter ? | consolidation pondérée **30/20/20/15/15** ; chaque score = preuve+date+source+confiance |

## 5. Priorisation des sources (PROCESS Annexe B)

- **Tier A — investigué pour de vrai** (auto. forte, public/gratuit) : Données
  Québec (CKAN API), rôle d'évaluation open-data, cadastre allégé, avis publics
  PDF, BDZI, GRHQ, CPTAQ cartes/décisions, permis, Adresses Québec, StatCan.
- **Tier B — tenté** (scraping/OCR/LLM) : zonage municipal + grilles PDF, PV
  conseils, schémas MRC, YouTube (transcription).
- **Tier C — documenté comme manque** (payant/restreint, non bloquant) : registre
  foncier (1,50 $/doc), JLR, Centris/MLS.

## 6. Source YouTube (VISION §4.3)

Pipeline : localiser la chaîne YouTube de la Ville → identifier les séances de
conseil où 150-49 / 150-51 sont discutés → obtenir la transcription (captions ;
sinon `yt-dlp` + whisper via obscura/conteneur) → extraire les mentions de
densification / hauteur / zonage / intentions politiques → **relier au dossier**
(numéro de règlement, zone). Alimente Phase 1 (signal détaillé, intentions) et
Phase 5 (contexte). Faisabilité (disponibilité des captions, volume) documentée
honnêtement ; si transcription non obtenable dans le 1er passage → marqué Tier B
partiel, pas bloquant.

## 7. Livrables

1. **Investigation sources réelle** (`docs/spec/SPEC_EVOL_DATA_MODEL.md` + notes
   de spike) : par source → rôle/phase (PROCESS Annexe A), accessibilité réelle
   constatée, **échantillon réel récupéré** (avec lien/date), et le manque.
2. **3 fiches opportunité peuplées** (structure PROCESS §4) : identité (lots
   réels), signal, potentiel, contraintes, marché, contexte, action — avec
   recollement multi-sources et **score pondéré tracé**.
3. **Vue démo « Opportunité bout-en-bout »** : deep-dive des 6 phases + faisceau
   de preuve par source + score, accessible depuis le Radar (4ᵉ entrée de menu ou
   ouverture depuis une opportunité du Radar).

## 8. Modèle de données (esquisse, à confirmer en investigation)

- `EvidenceItem` : { phase, sourceId, label, url, date, obtentionMode, confidence,
  value (texte/num), verification: fait|hypothese|non-disponible }.
- `OpportunityDossier` : { id, signal(règl/zone/dates), lots[] (cadastre/rôle),
  constraints[], market[], context[], scores{potentiel,risque,timing,faisabilite,
  marche} avec evidence[] par critère, scoreGlobal, recommendation }.
- `SourceRole` : { sourceId, phase, role (Annexe A), tier, accessibilite, autom }.

## 9. Mécanique d'exécution

Branche `feat/vertical-slice-valleyfield`. Investigation réelle via agents en
parallèle (découpage par couche de source ou par opportunité) + obscura/`make`
pour le fetch (Données Québec API, téléchargements géospatiaux, PDF, YouTube).
Tout via `make` (pas de docker/npm direct). Données brutes → S3 (politique
storage) ; métadonnées/scores → modèle versionné. ENV de test dédié, jamais dev.

## 10. Critères de succès

- Les 3 fiches sont peuplées avec des **lots réels** et des **contraintes réelles**
  (ou « non disponible » honnête), chaque item tracé.
- La vue démo montre le **recollement** (mêmes preuves, plusieurs sources) et le
  **raffinage** (6 phases) de façon lisible.
- L'investigation source documente, par source, son **rôle/contribution** et son
  **accessibilité réelle** (Tier A confirmé en pratique, Tier B tenté, Tier C
  marqué).
- Aucune donnée inventée. Toute affirmation invérifiable = exclue ou marquée.

## 11. Hors scope (1er passage)

- Sources Tier C payantes (registre foncier, JLR, Centris) — documentées, non
  intégrées.
- Automatisation continue / ordonnancement (ce slice est une matérialisation, pas
  le moteur de production).
- Carte interactive (BR-10).
