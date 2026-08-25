# Cohorte vivier-B « Nouveau B » — DÉNOMINATEUR reproductible (≠ cohorte d'audit PV)

> ⚠️ **LIRE EN PREMIER — ne pas keyer l'audit PV / Model A sur cette liste.**
>
> Ceci est le **dénominateur vivier-B « Nouveau B » live, province-wide** (reproduction versionnée du
> rail affiché par l'onglet Nouveau B). Ce n'est **PAS** la cohorte d'audit PV / Model A L1.
>
> - **Audit PV / Model A L1 → `docs/spec/reports/set-167-bprime.tsv` (167 slugs, dans `main`), `--expected-count=167`.**
>   set-167 contient les 18 munis batch (mesuré 10/10 ∈ set-167, 0/10 ∈ ce 127). Keyer l'audit sur ce 127
>   enverrait toute ligne ∈167-mais-∉127 en L3 ENOENT (c'est la cause du bug « phantom-127 »).
> - **Ce fichier (127) = rail DIFFÉRENT** : vivier-B live, déborde de 167 (intersection mesurée = **39 communs** ;
>   127-seul = 88 villes province-wide hors palier). Usage : **dénominateur** du vivier-B, pas dénombrement PV.

## Trois nombres, réconciliés (cf. verdict recette `s3://…/scratch/reviewpass/COHORT_PIN_VERDICT.md`)

| nombre | ce que c'est | committé ? |
|---|---|---|
| **124** | vérité-terrain **owner** (screenshot UI live, 185 sig · 124 villes, 5 ancres) — **pas de liste-slugs committée** (mur 401, export UI authentifiée seulement) | ❌ |
| **127** | **reproduction** de ce rail depuis le dump 2026-08-06 (dates nulles gardées) — **+3 vs owner** = vintage dump 4 j + `now` exact du screenshot ; **5/5 ancres OK** | ✅ ce fichier |
| **167** | `set-167-bprime.tsv` — cohorte **palier/PV** autoritaire, dans `main` | ✅ (main) |

> ℹ️ **`now=2026-08-10`** (dans le TSV/METHOD) = **paramètre NOW délibéré** de la reproduction (la borne
> de fenêtre du screenshot owner), PAS un timestamp de génération ni un skew d'horloge. C'est le `now`
> passé en argument pour rejouer la fenêtre 6-mois telle que l'owner la voyait.

Le **124 exact** n'existe sur aucun artefact committé (seulement compte + 5 ancres). Si une décision exige
la liste-124 exacte → **escalade owner** (export UI authentifiée, ou ratification de ce 127-repro comme proxy
accepté). geo-cond n'en a PAS besoin pour Model A L1 (qui se key sur set-167).

## Contenu
- `reproduce-cohort.ts` — rejoue le VRAI pipeline de production (voir `METHOD.md`) ; échoue en code 2 si les
  5 ancres owner ne matchent pas (fidélité vérifiée, pas supposée).
- `METHOD.md` — définition exacte (fonctions de prod importées, intersection z∧r∧p, fenêtre 6 mois, exclusions).
- `cohorte-vivier-b-6mo.slugs.tsv` — sortie versionnée (127 slugs, dump 2026-08-06, now=2026-08-10).
- `tsconfig.json` — config tsx pour l'invocation.

## Provenance
Dump prod-PG `graph_nodes` : `s3://radar-immobilier-docs-pocs/scratch/postbrossard-7263-20260803/graph_nodes.ndjson`
(export OVH read-only 2026-08-06, 7298 nœuds, sha256 `d9cb3cc6b9700caa1ba711d7fa204597e2db8be6b4002a764a7f386a43e57699`).
Pour le 185·124 exact : rejouer ce script sur un dump frais (job 39-export OVH).
