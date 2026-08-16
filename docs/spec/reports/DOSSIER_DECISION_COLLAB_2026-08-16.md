# Dossier de décision — Collaboration multi-utilisateur (§2)

> Spec : `SPEC_EVOL_COLLABORATION_MULTIUSER_2026-08-15.md`. Revue **Fable 5** = PRÊTE-AVEC-RÉSERVES.
> Décisions owner 2026-08-15/16.

## 1. Décisions owner ratifiées
- **Identité & tenancy (O3+O4)** : **multi-tenant réel + IdP/Sentropic** (identité/membership côté Radar autour du `sub` + claims IdP/Sentropic). Détermine C01.
- **Archive « pour tous » (O2)** : réservée à un **rôle modérateur** (contributeurs = personnel/restreint).
- **Sémantique d'ancre** : **cible = objet métier** (city/signal/zone/lot/reglement) ; ancre UI = métadonnée avec repli.
- **Suppression (O1)** : **tombstone + rétention** (jamais de hard-delete).

## 2. O1 — RÉSOLUTION via échange archi Sentropic (s-archi, passe in-process opus)
Grounding = source réelle `@sentropic/comments` 0.1.0.
- **Target kinds DÉJÀ extensibles** : `kind:'record'` + `recordType` OPAQUE. city|signal|zone|lot|reglement mappent via `{kind:'record', recordType:'…'}` — **aucun changement package pour les cibles** (corrige le cadrage « message|canvas|artifact »).
- **Hard-delete CONFIRMÉ = le vrai gap** : thread plat, supprimer le root perd le contenu + casse l'ancre root/summary + viole O1 (ni tombstone ni rétention). `edit` écrase en place ; ni follow ni visibilité/ACL ni révisions.
- **RECO = SPLIT-PAR-COUCHE** (ni package pur, ni adaptateur pur) :
  - **Le PACKAGE porte l'INTÉGRITÉ** (il possède `delete()`) = tombstone/soft-delete + rétention → **`@sentropic/comments v0.2.0`**. Un tombstone porté seulement par un adaptateur Radar laisse le `delete()` hard du package = footgun pour tout consommateur.
  - **L'adaptateur Radar porte la POLITIQUE-hôte** = mapping `recordType` (trivial), visibilité (injectée), follow (host-side jusqu'à promotion).
- **Phasage** :
  - **v0.2.0 (GATE C04/SNT1)** : soft-delete non-orphelinant + rétention (`deletedAt`/`deletedBy` + redaction-selon-politique ; ligne conservée ; hard-purge derrière `purge()` explicite host-gated). Store + in-memory + **adaptateur PG hôte (api/)** + tests. Effort MOYEN, 1 cycle build→review indépendant.
  - **v0.3.0 (après E1 Radar)** : visibilité/ACL en **filtre appliqué par le store** (package ajoute `visibility` + injection prédicat-ACL viewer) + révisions (historique append-only). Effort MOYEN-GRAND.
  - **Follow** : host-side maintenant ; surface package mince plus tard. Effort PETIT.

## 3. Gate de réalisation
- **C04/SNT1 débloqué pour DESIGNER** contre `kind:'record'+recordType` **maintenant** (cibles).
- **Tout chemin delete/archive ATTEND `comments v0.2.0`** — Radar ne doit PAS hard-delete via le package actuel.
- ⇒ **E1 Radar dépend de `@sentropic/comments v0.2.0`**. `builder ≠ reviewer` (re-review indépendante avant merge).
- Suite : demander à s-archi le **contrat de types v0.2.0** (shape tombstone + signature `purge()`), puis cadrer E1 Radar.

## 4. Contrat de types `@sentropic/comments` v0.2.0 — FIGÉ (réf E1 Radar, s-archi 2026-08-16)
- **`CommentTombstone`** : `deletedAt` (ISO), `deletedBy` (`CommentAuthor` opaque, pas de join user),
  `bodyDisposition: 'retained'` (défaut O1, body conservé, ligne marquée supprimée) `| 'redacted'`
  (placeholder ; original non récupérable côté package), `reason?` (tag hôte). `Comment.tombstone?` présent ⇔ soft-deleted.
- **`delete()` devient SOFT (BREAKING)** : `delete(tenant, id, by, opts?) → Promise<Comment>` (était `void`) ;
  pose le tombstone, **préserve la ligne** (thread + ancre root + summary survivent) ; idempotent ; ne retire JAMAIS la ligne.
- **`purge()` = seul hard-remove, host-gated, THREAD-ATOMIQUE** : `purge(tenant, {olderThan, targetKind?, reason?})` ;
  n'opère que sur des lignes DÉJÀ tombstonées `deletedAt < olderThan` ; un thread n'est purgé que si TOUTES ses lignes
  sont éligibles (partiel = skippé → invariant no-orphan tenu même à la purge). Package ne décide ni rétention ni authz.
- **Queries/summary tombstone-aware** : `includeTombstoned?` (défaut true) ; summary `rootMessage`/`lastMessage`
  tombstone-aware ; `tombstonedCount?` ; `messageCount` = lignes live. **Événements** : `comment.tombstoned` / `comment.purged`.
- **LAYERING** : (i) **package `@sentropic/comments` v0.2.0** = contrat `CommentStore` (delete→soft + purge) + `types.ts`
  (+`CommentTombstone`) + **ref in-memory** + events → **construit/publié côté Sentropic** ; (ii) **Radar `api/`** = adaptateur
  **Postgres** `CommentStore` (UPDATE colonnes tombstone au lieu de DELETE ; `purge` = DELETE thread-atomique) **+ 1 migration**
  (`deleted_at`/`deleted_by`/`body_disposition`/`reason`) → **volet E1 Radar** ; (iii) **Radar immo** = adaptateur mince
  (mapping `record/recordType` + visibilité injectée + follow host-side ; **ne ré-implémente PAS** delete/tombstone).
- **Gate chain** : **Sentropic publie `comments v0.2.0`** → **E1 Radar** (adaptateur PG + migration + adaptateur mince) contre ce contrat.
  `builder ≠ reviewer`. Bump gate package (`npm view @sentropic/comments version` puis `0.2.0` strictement >). Révisions/edit append-only = v0.3.0.

## 5. Build v0.2.0, migration SQL, événements, et FLAG DE FRONTIÈRE (s-archi 2026-08-16)
- **Build/publication `comments v0.2.0` = Sentropic-side confirmé** (`packages/comments` Sentropic-owned, PAS immo).
  s-archi possède le SPEC figé + porte la re-review indépendante ; **relaie la version npm publiée** ; gate =
  `npm view @sentropic/comments version == 0.2.0`. Pas de date. **E1 Radar reste gaté dessus.**
- **⚠️ FLAG DE FRONTIÈRE (à confirmer avant de scoper E1)** : la table `comments` + son adapter PG vivent dans le
  **`api/` PARTAGÉ de Sentropic**. Deux topologies, qui changent qui écrit la migration :
  - **(T1) Radar réutilise le store comments partagé Sentropic** → soft-delete PG + migration = **travail Sentropic `api/`**
    (partagé, honore O1 pour TOUS les consommateurs) ; **E1 Radar = adaptateur MINCE seul** (record/recordType + visibilité +
    follow). Cohérent avec « réutiliser Sentropic, pas de système parallèle » (O5) + multi-tenant/IdP Sentropic. Implication :
    les `prospect_*` migrent vers le store partagé (cross-service).
  - **(T2) Radar a son PROPRE store comments** (service/DB immo) → E1 Radar possède l'adaptateur PG + migration (gate-chain §4 tient).
    Plus de séparation, risque de duplication de modèle.
  - **Topologie owner-gated** ; faisabilité T1 (migration `prospect_*` cross-service, latence, couplage) à confirmer par **i-arch**.
- **Migration SQL (esquisse, table réelle `comments` : `workspace_id`/`created_by`/`content`/ts sans tz, 1 fichier)** :
  `ADD deleted_at ts · deleted_by text FK users(id) ON DELETE SET NULL · body_disposition text CHECK IN ('retained','redacted') ·
  deleted_reason text` + index partiel `(workspace_id, deleted_at) WHERE deleted_at IS NOT NULL`. `delete()` = **UPDATE** (idempotent
  `AND deleted_at IS NULL`, `content=''` si redacted) ; `purge()` = **DELETE thread-atomique** (`HAVING bool_and(deleted_at NOT NULL
  AND deleted_at < cutoff)`).
- **Événements** : réutiliser `'deleted'` (soft-delete, `data:{tombstone}`, wire-compat) + ajouter `'purged'` (1×/thread,
  `data:{purgedIds, reason?}`) ; enveloppe `redactedFields:['content']` si redacted (pass-through).

## 6. Topologie — choix owner T1 + reframe s-archi + gate factuel i-arch (2026-08-16)
- **Owner** : **T1 (store Sentropic partagé)** — préférence, sous la framing « réutiliser Sentropic ».
- **Reframe s-archi (dé-conflation)** : le **package `@sentropic/comments` v0.2.0** (contrat + types + events + ref) est l'unité
  de réuse — **partagé DANS TOUS LES CAS**. « Réutiliser Sentropic / pas de système parallèle » (O5) est **satisfait en T1 ET en T2**
  (même contrat package). T1 vs T2 = **uniquement la topologie du STORE PHYSIQUE**, déterminée par le **déploiement immo** :
  - **immo co-déployé avec `api/` Sentropic (même DB)** → **T1 propre** (isolation workspace/tenant déjà en place → pas de régression) ;
  - **immo = service/DB séparé** → **T2 sur le même contrat** (T1 imposerait des lectures/écritures comment cross-service = latence + couplage).
- **Gate FACTUEL = i-arch** (connaît le déploiement immo) : si immo co-déployé même DB → T1 tenu ; si immo service séparé → **T2 est le
  choix technique** (toujours réuse-compliant, même contrat) et je **RE-SURFACE à l'owner** (son T1 était une préférence sous la framing
  réuse, pas une contrainte de déploiement).
- **Invariant dans les deux cas** : package v0.2.0 identique, `builder ≠ reviewer`, O1 tenu.
