# Audit consolidation Track — drift depuis mardi 2026-06-23

Date: 2026-06-26  
Repo: `radar-immobilier`  
Statut: **document de consolidation, lecture seule vis-à-vis de `.track`**  
Sources principales:

- `tmp/track-audit/agent-a-opus-track-history.md`
- `tmp/track-audit/agent-b-opus-track-history.md`
- `tmp/track-audit/sonnet-track-audit.md`
- `.track/events.jsonl`
- `git log --all` / branches locales et remote
- transcripts Claude locaux sous `/home/antoinefa/.claude/projects/-home-antoinefa-src-radar-immobilier/*.jsonl`

> Objectif: stocker l’état des lieux et préparer une reprise propre du tracking.  
> Ce document ne modifie pas Track; il définit les corrections à appliquer ensuite via le writer/CLI Track officiel, jamais par édition manuelle du JSONL.

---

## 1. Verdict

Le drift Track est confirmé par deux audits Opus indépendants.

- La chaîne `.track` paraît techniquement intègre.
- Le problème est **sémantique**: les décisions, demandes utilisateur et PRs depuis mardi ne sont plus consolidées en items Track cohérents.
- Avant mardi 2026-06-23, le tracking était globalement lisible: Graphify v2.3, evidence contract, geo/PDF overlay, geo zones/lots, auth fixes existaient comme fils reconnaissables.
- Depuis mardi, des travaux rapides/branches/PRs ont été mergés ou laissés en worktree sans que Track garde le fil produit/architecture.

Conséquence: Track contient des feuilles/bugs et quelques DONE génériques, mais il ne raconte plus correctement les **chantiers transverses**.

---

## 2. Domaines où le drift est avéré

### 2.1 Graphify / grounding / citations

Item principal:

| Item | Titre | État Track | Diagnostic |
|---|---|---|---|
| `01KVB478A9NVXDWQPZPK8T8PZ9` | Graphify v2.3 — Sonnet 4.6 descriptions and exhaustive citations | `in-progress` | État strictement défendable si “exhaustif” signifie zéro reliquat; mais Track manque les progrès récents. |

Preuves de progrès non suffisamment reliées à Track:

| Sujet | Preuves |
|---|---|
| Contrat/runner v2.3 | `3f94bc1`, `d0e6f7b`, `1d58f25` |
| Pilotes grounding | `7a7706d`, `2a7ce44` |
| Pipeline grounding massif | `b9ecbd1`, `742116d` |
| Helpers backfill citations | `7d1632d` |
| Projection/gate Postgres | `071bba4` |
| Auto-link PV provisoire | `9b59373`, `8c6c97b`, `28f369a` |
| Citation recalc / Graphify 0.17 | `a742ebd`, `73336e9` — attention: selon audit, non stabilisés sur `origin/main` au moment de l’inspection |

Reliquats observés dans artefacts locaux:

| Run | Résultat |
|---|---|
| `tmp/grounding-383-20260619T155600Z` | `246 done`, `62 blocked` |
| `tmp/grounding-final-20260624T235606Z` | `saint-eustache blocked` |
| `tmp/grounding-resume2-20260626T032908Z` | `dunham done`, `chibougamau done`, `laurierville blocked`, `saint-eustache blocked` |

Conclusion: ne pas passer l’item v2.3 à DONE sans décision explicite de changement de scope. Le bon recalage est d’ajouter des événements de progrès et de créer des reliquats enfants si nécessaire.

---

### 2.2 Consolidation citation / PDF / preuve

Track actuel contient des fragments:

| Item | Titre | État |
|---|---|---|
| `01KVB2KF6PE59JBH38SGTGD580` | Graphify evidence contract — signal description, citation and PDF link | DONE |
| `01KVDWBTA3E5KGRKR4Q649GYZ9` | Geo PDF overlay integration — signal evidence viewer with page bbox | DONE |
| `01KVPBAHTPHH48EC4P7SED2QGX` | PDF viewer Preuve ne rend pas | DONE |

Mais il manque un parent/fil architectural:

> **Consolidation couche preuve — graphify refs → citation → raw/PDF → route document → viewer → overlay geo → fallback honnête.**

Travaux Git retrouvés mais dispersés:

| Sujet | Preuves |
|---|---|
| Viewer preuve page-focalisé + highlight | `80c4eff` |
| Route interne `/api/documents/raw` | `21211cd` |
| Fallback scrapeStore documents | `744f3be` |
| Worker pdf.js MIME | `c144203` / PR #295 |
| Viewer v2 scale/highlight | `c5827c2` / PR #299 |
| Multi-signaux PDF | `acd67b2` / PR #300 |
| Worker/cache | `fcae4bc` / PR #301 |
| Navigation signal | `598ead0` / PR #302 |
| Preuve indisponible honnête | `f5dbdbf` / PR #304 |
| Header preuve | `461cf58`, `a81ab99` / PR #307 |

Conclusion: le travail existe par PRs, mais Track ne conserve pas la consolidation “couches citation/PDF/preuve”.

---

### 2.3 Déport / ownership PDF-preuve vers geo

Traces retrouvées:

| Élément | Preuves |
|---|---|
| Division DATA immo↔geo | branche/commit `docs/data-division-immo-geo`, `3021485` |
| Clarification scraping PV ownership immo vs geo | `e109a65`, PR #269 |
| Bugs geo/PDF prioritaires trackés | `630a05c`, branche `chore/track-geo-pdf-bugs` |
| PDF via route interne / scrapeStore | `21211cd`, `744f3be` |
| Geo signal→zone/lot multi-source + citation/flèche/adresse | `8173591`, `4639c4d`, `5de8992` |

Drift: la décision “preuve/PDF devient une couche native du parcours geo/signaux” existe dans les traces, mais pas comme item Track consolidé.

---

### 2.4 Auth Sentropic — autorisation/login permanent, refresh 15 jours, stockage autorisation

Constat code courant:

- `api/src/config.ts` définit `SESSION_TTL_SECONDS` avec défaut `28800` secondes = **8h**.
- Aucun réglage déployé `SESSION_TTL_SECONDS=1296000` n’a été retrouvé dans `deploy/k8s/80-auth.yaml`.
- La logique récente contient des corrections `prompt=login` / `select_account` visant les problèmes d’invitation, logout et changement de compte.

Commits auth majeurs retrouvés:

| Commit / PR | Sujet |
|---|---|
| PR #260 / `f7c49a8` | casser boucle login/app mobile non enrôlé |
| PR #265 / `4b008a8` | logout fiable + IdentityMenu DS + menu Admin gated |
| PR #267 / `6ffe276` | invitation prime sur rejected/suspended |
| PR #280 / `1ad65e1` | invitation ne crée jamais session sans IdP + logout cookie aligné |
| PR #284 / `3485560` | forcer ré-auth IdP `prompt=login` + `/me` non caché |
| PR #290 / `d0d42ef` | reconnecter → `prompt=select_account` |
| PR #293 / `bb2b89a` | `prompt=login` honoré par IdP au lieu de `select_account` ignoré |

Demande utilisateur récente:

> gérer le problème de redemande permanente des autorisations et de login; refresh à 15j; stocker l’autorisation.

Diagnostic:

- Cette demande n’est pas matérialisée dans Track comme item autonome.
- Elle n’est pas réalisée par le code courant: TTL défaut 8h, pas 15j.
- Elle ne doit pas être confondue avec les fixes de sécurité qui forcent une ré-auth dans certains flux.

---

### 2.5 Pollution par petits PRs DS/header et divergence de branches

Les audits signalent que la branche courante `feat/appheader-ds` diverge fortement d’`origin/main` et contient des commits locaux/non-main. Les petits PRs DS/header ont consommé du contexte et masqué les fils métier.

Règle de consolidation:

- distinguer preuve mergée sur `origin/main`, preuve branche locale, preuve worktree, intention conversationnelle;
- ne jamais clôturer un item Track global sur la seule base d’un artefact local non stabilisé.

---

## 3. Corrections Track proposées

> À appliquer via le writer/CLI Track officiel. Ne pas éditer `.track/events.jsonl` à la main.

### Batch A — documenter le drift et la consolidation

Créer un item de consolidation Track:

```text
Titre: Recalage Track — drift post-2026-06-23 et consolidation des fils Graphify/PDF/Geo/Auth
Workspace: meta-track ou équivalent
Kind: chore
Realization: in-progress
Statement: Audit Opus A/B du 2026-06-26 confirme un drift sémantique: travaux Graphify/citations, PDF/preuve/geo et auth 15j dispersés en PRs/branches sans items consolidés. Source: docs/spec/audit-track-drift-2026-06-26.md.
```

### Batch B — Graphify v2.3

Sur `01KVB478A9NVXDWQPZPK8T8PZ9`, ajouter des critères de progrès, sans DONE strict:

```text
Progrès v2.3: contrat evidence + runner central + preflight/gate/publish livrés. Preuves: 3f94bc1, d0e6f7b, 1d58f25.
```

```text
Progrès grounding: pilotes Rimouski/Mont-Tremblant + pipeline verbatim + run 383 villes. Artefact local: tmp/grounding-383-20260619T155600Z/status/central.jsonl = 246 done / 62 blocked. Preuves commits: 7a7706d, 2a7ce44, b9ecbd1, 742116d. Non exhaustif: villes bloquées restantes.
```

```text
Reprise citations 2026-06-26: dunham et chibougamau publiés après backfill manuel; laurierville et saint-eustache restent bloqués par citations manquantes. Artefact: tmp/grounding-resume2-20260626T032908Z/status/central.jsonl.
```

```text
Outillage backfill citations ajouté: 7d1632d avec tools/grounding/ground-citations-from-snippets.py et publish-citation-grounding.sh. À distinguer d’une complétion exhaustive.
```

Créer ou mettre à jour les reliquats:

```text
Titre: Reliquats grounding citations — laurierville / saint-eustache / villes bloquées
Workspace: wp5-ontology
Kind: bug/chore
Statement: Les runs de reprise 2026-06-26 laissent laurierville et saint-eustache bloqués; suivre séparément du DONE de couverture prioritaire.
```

### Batch C — consolidation citation/PDF/preuve

Créer un item parent:

```text
Titre: Consolidation couche preuve — citation/PDF/rawRef de graphify au viewer
Workspace: wp5-ontology ou frontB-geo
Kind: feature
Statement: Regrouper les PRs de preuve dispersées: refs graphify, citation, sourceUrl/rawRef, page/bbox, route /api/documents/raw, fallback scrapeStore, viewer preuve, multi-signaux, navigation signal, affichage honnête preuve indisponible. Preuves: 80c4eff, 21211cd, 744f3be, c144203, c5827c2, acd67b2, fcae4bc, 598ead0, f5dbdbf, 461cf58, a81ab99.
```

Critères d’acceptation proposés:

1. API expose citation/sourceUrl/rawRef/page/bbox de manière normalisée.
2. Viewer utilise la route interne `/api/documents/raw` et ne dépend pas d’URLs CORS fragiles.
3. ScrapeStore est consulté quand le store principal ne contient pas le document.
4. Multi-signaux et navigation signal fonctionnent.
5. Absence de preuve est affichée honnêtement.
6. Ce parent ne valide pas l’exhaustivité Graphify: seulement la couche de restitution de preuve.

### Batch D — ownership geo de la preuve

Créer un item:

```text
Titre: Ownership geo de la preuve PDF liée aux signaux/zones/lots
Workspace: frontB-geo
Kind: feature
Statement: Formaliser que le parcours geo/signaux consomme les preuves PDF/citations produites par DATA/Graphify et les rend comme couche geo native. Sources: docs/data-division-immo-geo, e109a65, 3021485, 630a05c, 8173591, 4639c4d, 5de8992.
```

Critères:

1. DATA/Graphify produit refs et documents.
2. Geo résout signal→zone/lot et affiche la preuve associée.
3. Les responsabilités immo vs geo sont explicites.
4. Les bugs geo/PDF ne sont plus masqués sous un seul bug viewer.

### Batch E — Auth durable Sentropic 15j

Créer un item autonome:

```text
Titre: Auth durable Sentropic — éviter redemande permanente, session 15j, autorisation persistée
Workspace: auth ou platform
Kind: bug/feature
Statement: Demande utilisateur 2026-06-26: gérer la redemande permanente des autorisations/login, passer le refresh/session à 15 jours et stocker l’autorisation. Le code courant garde SESSION_TTL_SECONDS=28800 par défaut et le déploiement ne fixe pas 1296000. Ne pas confondre avec les fixes de sécurité prompt=login pour invitation/changement compte.
```

Critères d’acceptation:

1. `SESSION_TTL_SECONDS` effectif prod = `1296000` secondes, ou défaut code ajusté si accepté.
2. Le login normal ne force pas `prompt=login`.
3. `prompt=login` reste réservé aux flux sensibles: invitation/enroll, logout complet, changement de compte explicite.
4. Autorisation/consentement stocké côté IdP Sentropic ou côté RP selon contrat documenté.
5. Test: reload/session après 24h simulées ne redemande pas login si cookie valide.
6. Test: invitation et changement de compte forcent bien la ré-auth.
7. Documentation de la séparation sécurité vs confort session.

### Batch F — items anciens à recalibrer

| Item | Action proposée |
|---|---|
| `01KVB3PV4X8AXSZR5DF249X21X` Graphify version parity | Mettre `in-progress` + noter que la parité 0.17 n’est pas stabilisée sur main si c’est encore vrai. |
| `01KVB2FB12QHXSE2J2ZMRA45NC` Graphify v2.2 redo | Annuler comme subsumé par v2.3, ou le garder actif explicitement; ne pas laisser TO-DO ambigu. |
| `01KTWQEP5BDD711394PPKBP234` graphify→DB Postgres | Clôturer comme réalisé/doublon via A.3.1 si validé. |
| `01KTWQEH2ATBCD75BDZY48GWHC` parsing graphify PV | Passer `in-progress`, partiel non exhaustif. |
| `01KTWQF6YVGJKWNRC99FNQ7XGR` orchestration remote | Passer `in-progress` ou re-scoper; pas DONE sans preuve remote. |

---

## 4. Procédure sûre de reprise

1. Ne pas éditer `.track/events.jsonl` ni `.track/head.json` manuellement.
2. Avant écriture: `track validate` ou MCP `track_validate`.
3. Écrire uniquement via le writer/CLI officiel.
4. Ajouter d’abord les items de consolidation; ensuite seulement transitions/cancellations.
5. Après chaque batch: `track validate`, `track report`, `git diff -- .track`.
6. Commit dédié Track, sans mélange UI/API:

```bash
git add .track/events.jsonl .track/head.json docs/spec/audit-track-drift-2026-06-26.md
git commit -m "chore(track): consolidate drift audit for graphify pdf geo auth"
```

---

## 5. À ne pas faire

- Ne pas passer `01KVB478A9NVXDWQPZPK8T8PZ9` à DONE si le scope reste “exhaustive citations”.
- Ne pas confondre “viewer PDF fonctionne” avec “toutes les citations Graphify sont exhaustives”.
- Ne pas utiliser les liens PV `provisional` comme preuve verbatim complète.
- Ne pas considérer un artefact `tmp/` comme preuve durable sans archivage ou commit.
- Ne pas masquer auth 15j sous les anciens fixes `prompt=login`; c’est un nouveau besoin produit/sécurité à part entière.

---

## 6. État stocké

Ce fichier est la consolidation de référence pour reprendre Track proprement.

Copies/rapports associés:

- `tmp/track-audit/agent-a-opus-track-history.md`
- `tmp/track-audit/agent-b-opus-track-history.md`
- `tmp/track-audit/sonnet-track-audit.md`
- `tmp/track-audit/track-drift-consolidation-2026-06-26.md`
