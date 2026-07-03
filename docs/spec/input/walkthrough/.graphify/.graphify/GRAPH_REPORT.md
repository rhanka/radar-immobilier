# Graph Report - .  (2026-06-10)

## Corpus Check
- Corpus is ~10 724 words - fits in a single context window. You may not need a graph.

## Summary
- 19 nodes · 27 edges · 4 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: mentionne: 8 · contient: 6 · discute: 2 · appartient_à: 1 · applique_à: 1 · autorise: 1 · est_affectée_par: 1 · est_permise_dans: 1 · est_un: 1 · implique: 1 · modifie: 1 · précède: 1 · propose: 1 · utilise: 1


## Input Scope
- Requested: all
- Resolved: all (source: cli)
- Included files: 1 · Candidates: recursive
- Excluded: 0 untracked · 0 ignored · 0 sensitive · 0 missing committed

## Graph Freshness
- Built from Git commit: `8c58ee9`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `Walkthrough démo radar-immobilier — transcript` - 13 edges
2. `Règlement de zonage` - 6 edges
3. `Procès-verbal municipal` - 5 edges
4. `Changement de zonage` - 3 edges
5. `Dérogation mineure` - 3 edges
6. `Ville de Saint-Damase` - 3 edges
7. `Zone 201` - 3 edges
8. `Règlement 3835` - 3 edges
9. `Avis public municipal` - 2 edges
10. `MRC de la Matapédia` - 2 edges

## Surprising Connections (you probably didn't know these)
- `Walkthrough démo radar-immobilier — transcript` --mentionne--> `Procès-verbal municipal`  [EXTRACTED]
  walkthrough-transcript.md → walkthrough-transcript.md  _Bridges community 0 → community 1_
- `Walkthrough démo radar-immobilier — transcript` --mentionne--> `Dérogation mineure`  [EXTRACTED]
  walkthrough-transcript.md → walkthrough-transcript.md  _Bridges community 0 → community 3_
- `Walkthrough démo radar-immobilier — transcript` --mentionne--> `Ville de Saint-Damase`  [EXTRACTED]
  walkthrough-transcript.md → walkthrough-transcript.md  _Bridges community 0 → community 2_
- `Dérogation mineure` --modifie--> `Règlement de zonage`  [EXTRACTED]
  walkthrough-transcript.md → walkthrough-transcript.md  _Bridges community 3 → community 1_
- `Règlement 3835` --est_un--> `Règlement de zonage`  [EXTRACTED]
  walkthrough-transcript.md → walkthrough-transcript.md  _Bridges community 2 → community 1_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.29
Nodes (7): Carte interactive de zonage, rad-ar i-mmo dmo - 2026_06_09 17_49 EDT - Recording.mp4, Walkthrough démo radar-immobilier — transcript, Scraper de procès-verbaux, Vidéo de réunion municipale, Mistral Voxtral (voxtral-mini-latest), Transcription YouTube

### Community 1 - "Community 1"
Cohesion: 0.60
Nodes (5): Avis de motion, Avis public municipal, Procès-verbal municipal, Règlement de zonage, Changement de zonage

### Community 2 - "Community 2"
Cohesion: 0.50
Nodes (5): Habitation multifamiliale, MRC de la Matapédia, Règlement 3835, Ville de Saint-Damase, Zone 201

### Community 3 - "Community 3"
Cohesion: 1.00
Nodes (2): Dérogation mineure, Marge d'implantation

## Knowledge Gaps
- **7 isolated node(s):** `Mistral Voxtral (voxtral-mini-latest)`, `rad-ar i-mmo dmo - 2026_06_09 17_49 EDT - Recording.mp4`, `Carte interactive de zonage`, `Scraper de procès-verbaux`, `Vidéo de réunion municipale` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 3`** (2 nodes): `Dérogation mineure`, `Marge d'implantation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Walkthrough démo radar-immobilier — transcript` connect `Community 0` to `Community 1`, `Community 3`, `Community 2`?**
  _High betweenness centrality (0.723) - this node is a cross-community bridge._
- **Why does `Règlement de zonage` connect `Community 1` to `Community 0`, `Community 3`, `Community 2`?**
  _High betweenness centrality (0.227) - this node is a cross-community bridge._
- **Why does `Dérogation mineure` connect `Community 3` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **What connects `Mistral Voxtral (voxtral-mini-latest)`, `rad-ar i-mmo dmo - 2026_06_09 17_49 EDT - Recording.mp4`, `Carte interactive de zonage` to the rest of the system?**
  _7 weakly-connected nodes found - possible documentation gaps or missing edges._