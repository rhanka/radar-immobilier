# SPEC — Persistance durable « S3-first » (scaling 1000+ villes)

**Statut** : validé (consensus pairs Opus + Fable 5 ; Codex annulé) — prêt pour plan d'implémentation
**Date** : 2026-06-10
**Origine** : l'utilisateur a constaté que les résultats de scraping étaient committés en `*.fixture.ts` dans git et que rien n'était durable sur SCW S3 — inacceptable à 1000 villes. Méthode : consensus multi-pairs.

---

## 0. Principe directeur

> **SCW S3 est la SOURCE DE VÉRITÉ (immuable). Postgres est un INDEX/CACHE reconstructible.**
> `DROP DATABASE` doit être réparable par `rebuild-from-s3`, sans aucune perte. **Git ne contient que du code et de la config — jamais de donnée scrappée.**

Cette inversion source-de-vérité résout directement le « on va pas reperdre ça ailleurs que sur scw » : un crash du poste (on en a eu 5) ne perd plus rien — raw/parsed/graph sont déjà sur SCW.

État actuel = anti-pattern à corriger :
- résultats de scraping = ~57 `*.fixture.ts` dans git (2,9 Mo, croissance linéaire/ville) ;
- parsing/graphify = seedé dans un Postgres éphémère (perdu au crash) ;
- SCW S3 (`radar-immobilier-docs-pocs`) = **vide** (le code `ObjectStore`/`rawObjectKey` existe mais **personne n'appelle `put()`**).

---

## 1. Layout S3 (schéma de clés)

Bucket prod **dédié** (≠ `-pocs`), région `fr-par`. Règle : tout sous `raw/ parsed/ graph/ runs/` est **write-once** ; la mutabilité ne vit que derrière des pointeurs `latest.json` et sous `state/`.

**Adressage par contenu (CAS, sha256)** → dédup + idempotence gratuites.

```
# 1.1 RAW (CAS — immuable)
raw/{citySlug}/{sourceKind}/cas/{sha256}.{pdf|html}          # bytes natifs (opposables, anti-invention)
raw/{citySlug}/{sourceKind}/cas/{sha256}.meta.json           # RawDocumentRecord: url, fetchedAt, httpStatus, robotsOk, contentType, provenance

# manifeste de run = ENREGISTREMENT DE COMMIT + axe transaction-time du bitemporel
runs/{citySlug}/{sourceKind}/{YYYY-MM-DD}T{HHMMSS}Z-{runId}/manifest.jsonl
#   1 ligne/doc vu: {sha256, sourceUrl, publishedAt, httpStatus, casKey, status: new|seen|error}
#   validTime = publishedAt/date de séance ; knownAt = le run.

# 1.2 PARSED (clé = docSha × version parser → re-parse ciblé sur bump)
parsed/{citySlug}/{sourceKind}/{docSha256}/{parserVersion}/extract.json.gz   # mentions Zod (@radar/domain): règlements, zones, avisDeMotion, changementZonage, offsets
parsed/{citySlug}/{sourceKind}/{docSha256}/{parserVersion}/text.txt.gz        # texte extrait (pdftotext)

# 1.3 GRAPHIFY (non déterministe → version + inputsetHash + pointeur)
graph/{citySlug}/{graphifyVersion}/{inputsetHash}/graph.json.gz
graph/{citySlug}/{graphifyVersion}/{inputsetHash}/descriptions.json.gz        # wiki describe (cher → cache)
graph/{citySlug}/{graphifyVersion}/{inputsetHash}/inputs.json                 # (docSha, parserVersion) consommés → audit "quel PV a produit ce nœud"
graph/{citySlug}/latest.json                                                  # pointeur { graphifyVersion, inputsetHash, builtAt }

# 1.4 REGISTRE / ÉTAT / FIXTURES
registry/{gitSha}/cities.jsonl        # config 1000 villes, publiée depuis git au déploiement
registry/latest.json
state/{citySlug}/{sourceKind}.json    # scrape-status SHARDÉ (un écrivain par clé) — cf. §7 bug #2
fixtures/{family}/…                   # corpus de test étendu (hors git), tests d'intégration optionnels
```

**Immutabilité / coûts** : versioning bucket activé (ceinture-bretelles) ; lifecycle = pas d'expiration `raw/`+`graph/` (mémoire du système), Glacier `runs/` anciens si besoin. **Listing interdit en chemin chaud** → manifestes + `latest.json` font l'index ; LIST réservé au rebuild/audit, borné par préfixe ville (~10²–10³ objets). Ordre d'écriture = protocole de commit : bytes CAS → meta → manifest (dernier). Manifest présent ⇒ tout ce qu'il référence existe. Volumétrie raw ≈ 12 Go/an (<1 €/mois) ; le coût dominant = LLM graphify, maîtrisé par le cache CAS.

---

## 2. Mutualisation des 1000 scrapers

- **Registre de config = git** (`packages/radar-sources/registry/cities*.jsonl`), publié vers `registry/{gitSha}/` au déploiement. C'est du code-adjacent (casse des tests, mérite revue PR, ~200–500 Ko). Squelette généré depuis **Données Québec** (municipalités/MRC/codes géo) ; URLs PV complétées ville par ville.
- **Worker = process Node pur-S3** : adaptateur générique + config ville en entrée, S3 en sortie, **zéro Postgres, zéro docker-compose** (~100 Mo RAM). Le `proces-verbaux-generic.ts` est déjà injectable — il faut juste brancher la sortie sur le port `Storage` au lieu de fixtures.
- **Refresh incrémental (fenêtre 6 mois)** : (1) `sha256(indexHtml)` vs `state.lastIndexSha` → identique ⇒ run terminé en 1 requête (cas dominant ~95 %). (2) sinon `list(since = now − 183j)` puis par doc : sha connu ? HEAD `raw/.../cas/{sha}` ; absent ⇒ fetch + PUT. (3) écrire le manifest (y compris `seen`), puis `state`.

---

## 3. Fixtures test (git) vs donnée prod (S3)

- **Git : 6–10 fixtures « golden »**, une par **famille structurelle** de site (WordPress/Elementor accordéon, CMS municipal, index PDF plat…), **tronquées** au minimum qui exerce le parser, avec l'en-tête de provenance honnête déjà en usage. Tests unitaires hermétiques, offline, rapides.
- **S3 : corpus étendu** (`fixtures/`) pour tests d'intégration optionnels (`make test-corpus`, read-only, hors CI par défaut / nightly).
- **Script de promotion** : `radar fixture promote raw/{city}/…/{sha}` → la golden fixture naît d'un **échec parser**, pas de l'onboarding.
- **Migration** : les ~40 fixtures-villes actuelles sont **re-scrapées vers S3** (elles portent les URLs) puis supprimées de git au profit des goldens (provenance propre, pas de conversion .ts→S3).

---

## 4. Rôle de Postgres = index reconstructible

Tables = **projections** : `documents` (meta+manifests), `mentions`/`signals` (parsed), `graph_nodes`/`graph_edges` (graph `latest.json`, upserts `ON CONFLICT` existants), PostGIS lots/zones (Adresses Québec, géométries cachées en S3 après download). `scrape_status` = **vue projetée de `state/`**.

**Matérialisation** : table `projection_meta {stream, lastAppliedKey, parserVersion, graphifyVersion}`. Le **projecteur** (seul écrivain DB) lit les manifestes/pointeurs > `lastAppliedKey` et applique des upserts idempotents. **`radar db rebuild`** = LIST `runs/` + `graph/*/latest.json`, replay chronologique, cible < 1 h pour 1000 villes, **testé en CI** (MinIO + mini-corpus). Cohérence : la DB peut être *en retard*, jamais *en avance* (S3 écrit d'abord) ; lag accepté = minutes ; pas de 2PC.

---

## 5. Pipeline e2e

```
[worker scrape]   (S3 only, sans DB)
   GET index → sha inchangé ? stop. | fetch nouveaux → PUT raw cas + meta | PUT runs/.../manifest.jsonl  (commit)
[worker parse]    (S3 only ; déclenché par diff manifest vs parsed/)
   doc sans parsed/{parserVersion}/ → GET raw → pdftotext → extraction → PUT parsed/extract.json.gz  (idempotent HEAD-skip)
[worker graphify] (S3 only ; déclenché si inputsetHash change)
   graph/{city}/{ver}/{inputsetHash}/ existe ? skip. | graphify extract + wiki describe → PUT graph + inputs | PUT latest.json
[projecteur]      (SEUL process avec accès DB ; tourne avec l'API)
   manifests > lastAppliedKey → upsert documents/mentions/signals | graph latest.json modifiés → upsert graph_nodes/edges | avance projection_meta
```

**Scheduler = boucle de réconciliation** : `travail = désiré − présent` (diff de manifestes) — **pas de file de messages à opérer**. Chaque étape = fonction `(entrées CAS, version code) → clé déterministe` ; crash = relance + HEAD-skip. Un crash pendant graphify ne perd plus rien (raw/parsed déjà sur SCW).

---

## 6. Exécution des 1000 jobs (sans OOM)

- **Phase 1 (immédiat)** : runner local unique, `p-limit` 4–8 fetches concurrents, **politeness par domaine** (1 req/s/domaine, user-agent honnête), zéro Postgres embarqué. 1000 index + N PDFs = dizaines de minutes, ~100 Mo. **L'OOM disparaît par construction** : on ne boote plus aucune stack par ville (l'OOM venait des stacks docker/Postgres parallèles, pas du scraping).
- **Phase 2** : **SCW Serverless Jobs + Cron** (fr-par, même région que le bucket → pas d'egress, IAM scopé). Le worker phase 1 (sans état, S3-only) se containerise tel quel ; 1 job = batch ~50 villes (partition stable par hash slug), concurrence 4–8 jobs, cron quotidien ; graphify/LLM en jobs séparés (déclenchés sur inputset modifié).
- **Pas de file managée en v1** : la réconciliation sur S3 (manifests + state shardé) *est* la file. SCW Queues/NATS seulement si latence < 1 h devient un besoin.

---

## 7. Pièges / risques (à traiter EN PRIORITÉ)

1. **BUG `rawObjectKey()`** (`api/src/storage/object-store.ts`) : met `raw/{source}/{YYYY}/{MM}/{DD}/{sha}.{ext}` → la **date de fetch dans la clé casse la dédup par contenu** (même PDF refetché = autre clé). → **CAS pur** `raw/{city}/{kind}/cas/{sha}.{ext}` ; la temporalité va dans les manifestes. À corriger **avant le 1ᵉʳ objet réel**.
2. **BUG course `scrape-status/store.ts`** : `STORE_KEY="scrape-status/index.json"` + `readAll → upsert → put` sur **UN objet global** → **perte de mises à jour garantie** à 1000 villes concurrentes. → **sharder `state/{city}/{kind}.json`** (un écrivain/clé) ; l'agrégat devient une projection.
3. **Loi 25** : les PV bruts **contiennent des noms** (dérogations nominatives, période de questions citoyenne). Documents publics, mais : bucket `raw/` **privé, jamais servi tel quel** ; **filtrage PII au parsing** ; **schéma Zod de `extract.json` interdit tout champ « nom »** ; **jamais de personne physique comme nœud graphify**. Documenter finalité + rétention.
4. **Graphify non déterministe + coûteux** : sans clé `inputsetHash`, chaque re-run réécrit/re-paye → le cache CAS + pointeur `latest.json` (last-writer-wins, les deux versions restent) contiennent le coût.
5. **Bucket prod ≠ `-pocs`** : créer le bucket prod avec **IAM scopé** : clé write-only préfixe `raw/+runs/+state/` (scrapers), clé read-only (projecteur).
6. **« Reconstructible » non testé = mensonge** : `rebuild-from-s3` **doit** être un test CI (MinIO + mini-corpus).
7. **Dérive des sites municipaux** : ~quelques %/mois cassent (refonte CMS) → lignes `error` des manifests + `state` alimentent un dashboard de santé ; budget d'entretien permanent assumé.

---

## 8. Plan d'exécution (ordre)

1. **Geler l'anti-pattern** : plus aucune nouvelle `*.fixture.ts` de ville. Corriger bug #1 (`rawObjectKey` → CAS) + bug #2 (sharder `scrape-status`). *(petits, débloquent tout)*
2. **Brancher le worker scrape sur S3** (port `Storage`, le bucket est vide : gap le plus rentable) + manifestes de run. Re-scraper les ~40 villes des fixtures vers SCW.
3. **Persister `parsed/` et `graph/` sur S3** avant toute écriture DB ; pointeurs `latest.json` ; le seed Postgres devient le **projecteur**.
4. **`radar db rebuild` + test CI** (MinIO) — preuve que Postgres n'est plus la source de vérité.
5. **Réduire les fixtures git au golden set** (par famille) + script de promotion.
6. **Containeriser le worker → SCW Serverless Jobs + Cron** — passage 40 → 1000 villes sans toucher au poste.

Points 1–4 = durabilité à périmètre constant ; 5–6 = passage à l'échelle. **Aucune nouvelle brique d'infra** (pas de file, pas de lakehouse) — discipline de clés S3 + inversion source-de-vérité.

---

## 9. Coordination immo_subagents

`immo_subagents` est **en HOLD** (directives fixture-based annulées). Re-task « scrape → S3 » **seulement après** les étapes 1–3 (port Storage + clés CAS + worker écrit S3 + sharding) — sinon il génèrerait 500 fixtures git de plus (anti-pattern aggravé). Le nouveau work-order lui donnera le schéma de clés (§1) et le port `Storage` à utiliser.
