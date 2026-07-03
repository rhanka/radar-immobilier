# Étude — CrashLoopBackOff / mémoire `radar-api` (double consensus, 2026-07-02)

Deux études indépendantes (Opus 4.8 + Codex 5.5) sur le crashloop récurrent de
`radar-api` et le quota namespace jugé excessif (bumpé à 3 Gi). **Forte
convergence.** Synthèse réconciliée ci-dessous.

## Verdict partagé

**La prémisse « le bundling immo-mcp alourdit radar-api » est un faux
diagnostic.** Le process `node api/dist/index.js` n'importe **jamais** immo-mcp
→ **0 impact RSS** sur l'api. Le patch #322 (startupProbe + 768Mi) masque le
boot lent mais ne traite aucune des vraies causes → l'exit 137 reviendra sous
charge. Les deux études convergent sur **4 causes réelles** et une cible
mémoire.

## Causes racines (consensus)

| # | Cause | Effet |
|---|---|---|
| C1 | **Heap V8 non bornée au cgroup** — `NODE_OPTIONS` sans `--max-old-space-size` (les Jobs l'ont, pas l'api) | V8 ne GC qu'à ~2 Go ; le cgroup 768Mi tue avant → **exit 137** |
| C2 | **Probes couplées aux dépendances** — les 3 sondes tapent `/health` qui fait `select 1` + S3 HeadBucket et **renvoie 503** si PG/S3 hoquette ; Pool pg **sans `connectionTimeoutMillis`** | Un hoquet PG/S3 → liveness échoue → **kubelet KILL** (crashloop en régime) |
| C3 | **Imports lourds synchrones au boot** — `graphify` (36 Mo) chargé via routes ontologie/opportunités/signals au démarrage, sur ½ cœur CPU | boot lent (timeout liveness d'origine) + ~100-150 Mo RSS |
| C4 | **Fixtures geo non bornées** — cache `Map` jamais évincé (`simulation-provider`), JSON jusqu'à 24 Mo/ville (51 Mo total dans l'image) | +150-300 Mo heap crête en usage réel |
| C5 | **Image non prunée** — `node_modules` complet (dev deps : typescript, vite, playwright…) copié au runtime (~1 Go) | pull/rollout lents (pas le RSS) |

## Pistes classées (consensus effort × impact)

**Immédiat — tue proprement l'exit 137, trivial, bas risque :**
- **P1** `NODE_OPTIONS=--max-old-space-size=384` (aligné limite) — convertit l'OOMKill en pression GC gérée.
- **P2** **Découpler les probes** : `/livez` trivial (process vivant, sans DB/S3) pour startup+liveness ; `/health` (ou `/readyz`) DB/S3 pour **readiness seulement**.
- **P3** `pg.Pool({ connectionTimeoutMillis: 3000, max: 5 })` — plus de `checkDb()` qui pend.
- **P4** Mesurer le **RSS réel** (`kubectl top`, `process.memoryUsage`) avant de baisser les limites (prudence Codex).

**Régime mémoire — moyen effort :**
- **P5** Lazy-load `graphify` (`await import()` dans les 3 routes) → −100-150 Mo boot.
- **P6** Borner le cache fixtures (LRU-1) **ou** servir la geo depuis PostGIS (déjà peuplé par `populate-geo`) → −150-250 Mo.
- **P7** Pruner le runtime (`--omit=dev` / stage propre) → image −300-800 Mo.

**Architectural — à décider :**
- **P8** **Séparer immo-mcp en image dédiée lean** (dist self-contained 9 Ko → image ~50 Mo vs 1 Go). N'enlève pas de RSS à l'api mais découple release/rollback + fin de la fausse causalité.
- **P9** (Codex) **Séparer un `radar-worker`** (jobs geo/scrape/projection/migrate + `poppler`) de l'image web → base pour api-web < 512Mi.

## Cible mémoire (consensus)

Après P1-P7 : **api `limits 512Mi` / `requests 192-256Mi`, `--max-old-space-size 320-384`** ; MCP `limits 192-256Mi`. → steady-state namespace **~2-2,56 Gi**, **le bump à 3 Gi n'a plus lieu d'être**.

## Divergence (mineure)

Codex insiste : **garder 768Mi tant que le RSS réel n'est pas mesuré** (P4 avant P8/P9). Opus est plus agressif sur les cibles. → Réconcilié : appliquer P1/P2/P3 **maintenant** (ils corrigent la cause sans mesure préalable), **mesurer**, puis P5/P6/P7 et les splits P8/P9.

## Recommandation conducteur

1. **Sprint immédiat** (P1+P2+P3) : un PR trivial qui **corrige vraiment l'exit 137** là où #322 ne fait que le masquer. Bas risque, déployable en stride.
2. **Mesure** RSS réel post-P1 (P4).
3. **Sur go** : P5/P6/P7 (régime), puis P8/P9 (split images) pour ramener le quota sous 3 Gi.
