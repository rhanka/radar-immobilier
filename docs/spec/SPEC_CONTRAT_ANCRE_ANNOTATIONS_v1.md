# SPEC — Contrat d'ancre des annotations (i-arch#1) — v1

> **Statut** : contrat held pour gate i-cond + revue extraction (faisabilité).
> **Auteur** : i-arch (contrat). **Implémentation** : lane extraction (migration `0011` hand-authored + route Hono/zod + service + tests).
> **Décision produit** : owner D1–D4 + ruling « Option A forward-looking » (mono-client).
> Ce document définit le **contrat** (modèle de données, invariants, authz, API). Il ne contient pas l'implémentation.

## 0. Portée & non-goals

Ce contrat régit les **annotations libres** (`prospect_notes`) : leur **ancrage** (à quoi une note se rattache) et leur **cycle de vie** (création, édition, suppression, lecture).

**Dans le périmètre (§2, ce lot) :**
- Ancrage `target_type ∈ {signal, lot}` (zone **différée**).
- Attribution visible (`author_id`).
- Colonne de **scoping forward-looking, DÉFAULTÉE, INERTE** (mono-client).
- Authz : **lecture = tous les users approuvés** ; **mutation = author-only**.
- Cutover `prospect_notes` en migration `0011`, **0 backfill**.

**Hors périmètre (explicitement NON construit ici) :**
- ❌ Aucune table `clients`/`teams`, aucune FK `account_users.client_id`. Le multi-tenant réel = **lot AUTH cross-domaine séparé, ultérieur**.
- ❌ Aucune logique d'isolation inter-clients active (la colonne de scoping reste inerte).
- ❌ Ancrage `zone` (différé — réservé au vocabulaire `target_type`, non émis, non implémenté).
- ❌ Refonte des `prospect_marks` / `prospect_contacts` (append-only, inchangés).

## 1. État existant mesuré (source de vérité)

Migration `0005_prospect_marks.sql`, table `prospect_notes` **actuelle** :

| colonne | type | notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `no_lot` | TEXT NOT NULL | ancrage lot dénormalisé |
| `city_slug` | TEXT NOT NULL | ancrage lot dénormalisé |
| `author_id` | UUID NOT NULL → `account_users(id)` | attribution (déjà présente) |
| `body` | TEXT NOT NULL `char_length(body) > 0` | contenu libre |
| `mode` | `prospect_mode` NOT NULL DEFAULT `'real'` | `real` \| `simulation` |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | immuable |

Constats structurants :
- **Ancrage lot uniquement**, dénormalisé (`no_lot`, `city_slug`) — **volontairement sans FK bitemporale** (0005 : « les notes ne nécessitent pas de FK bitemporale stricte » → l'ancre survit à la rotation de `lot_versions`).
- `author_id` **déjà présent** → l'attribution ne demande aucun changement de schéma.
- Modèle **append-only aujourd'hui** (« une nouvelle ligne par note »), **sans** `updated_at`/`deleted_at`/`supersedes`. Les tables sœurs `prospect_marks` et `prospect_contacts` utilisent une chaîne `supersedes`/`superseded_by`.
- `account_users` (0004) est **PLAT / mono-client** : colonnes `id, sub, email, name, status, is_admin, created_at, approved_at, approved_by`. **Aucune** colonne client/tenant, **aucune** table `clients`. → l'isolation multi-client est **NET-NEUF**, il n'existe aucun multi-tenant où se brancher.
- `signals` (schema.ts) : `id UUID` **aléatoire** → `documents(id)` **ON DELETE CASCADE**. ⇒ `signals.id` **n'est PAS stable** à la ré-ingestion (nouveau UUID au re-scrape, cascade-delete si le document disparaît). C'est la raison même pour laquelle l'ancre lot est dénormalisée.

## 2. Modèle de données — cutover `prospect_notes` (migration 0011)

Migration **additive**, **0 backfill** (les lignes existantes restent valides via DEFAULT). Colonnes ajoutées :

```sql
-- 0011 (hand-authored par extraction) — additif, 0 backfill.
CREATE TYPE prospect_note_target AS ENUM ('lot', 'signal');  -- 'zone' différé, non inclus

ALTER TABLE prospect_notes
  ADD COLUMN target_type prospect_note_target NOT NULL DEFAULT 'lot',  -- ← 0 backfill : l'existant devient 'lot'
  ADD COLUMN signal_id   UUID REFERENCES signals(id) ON DELETE SET NULL,  -- ancre signal (jamais CASCADE — cf. §3.1)
  ADD COLUMN tenant_id   TEXT NOT NULL DEFAULT 'default',  -- scoping forward-looking, INERTE (cf. §3.3)
  ADD COLUMN updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- édition in-place (cf. §4)
  ADD COLUMN deleted_at  TIMESTAMPTZ;                          -- soft-delete (NULL = actif)

-- `no_lot`/`city_slug` deviennent conditionnels selon target_type (cf. CHECK).
ALTER TABLE prospect_notes ALTER COLUMN no_lot    DROP NOT NULL;
ALTER TABLE prospect_notes ALTER COLUMN city_slug DROP NOT NULL;

-- Cohérence ancre ↔ target_type :
--   lot    → no_lot + city_slug NOT NULL ; signal_id NULL
--   signal → signal_id NOT NULL (au create) ; no_lot/city_slug OPTIONNELS (contexte géo si résolu)
ALTER TABLE prospect_notes ADD CONSTRAINT chk_prospect_notes_anchor CHECK (
  (target_type = 'lot'    AND no_lot IS NOT NULL AND city_slug IS NOT NULL)
  OR
  (target_type = 'signal' AND (signal_id IS NOT NULL OR no_lot IS NOT NULL))
);

CREATE INDEX prospect_notes_signal_idx ON prospect_notes (signal_id);
CREATE INDEX prospect_notes_tenant_idx ON prospect_notes (tenant_id);
CREATE INDEX prospect_notes_active_idx ON prospect_notes (tenant_id, deleted_at)
  WHERE deleted_at IS NULL;
```

> **Note extraction** : `signal_id NOT NULL au create` pour `target_type='signal'` est une règle **applicative** (le CHECK l'autorise à devenir NULL par la suite via `ON DELETE SET NULL` sans perdre la note — cf. §3.1). L'exactitude du DDL (types drizzle, nommage) est cadrée par extraction sur le journal `0010` → `0011`.

## 3. Invariants

### 3.1 Durabilité de l'ancre (le plus important)
Une annotation **ne doit jamais être détruite par la ré-ingestion** de sa cible. Conséquences **contractuelles** :
- Ancre **lot** : `no_lot` + `city_slug` dénormalisés, **jamais** de FK bitemporale (statu quo 0005).
- Ancre **signal** : `signal_id` FK **`ON DELETE SET NULL`** — **JAMAIS `CASCADE`**. Si le signal est recréé (nouveau UUID) ou supprimé, la note **survit** (`signal_id` devient NULL) au lieu d'être cascade-deletée. Pour préserver le contexte, une note `signal` **peut** dénormaliser `no_lot`/`city_slug` quand le signal résout vers un lot (géo-mapper 0006/0007).
- **Binding ouvert (extraction/ontologie)** : une identité `signal` **stable à la ré-ingestion** (clé naturelle vs UUID volatile) n'existe pas aujourd'hui. v1 accepte la dégradation `SET NULL` (0 perte de note). Une clé signal ré-ingestion-stable = **suivi séparé** (ontologie), hors ce lot.

### 3.2 Attribution (D-attribution)
`author_id` est **toujours** peuplé (au create = user de session) et **visible en lecture** (id + nom/email résolus via `account_users`). Aucune note anonyme.

### 3.3 Scoping forward-looking INERTE (Option A)
`tenant_id TEXT NOT NULL DEFAULT 'default'` :
- **Préparée mais inerte** tant que mono-client. **Aucune** logique d'isolation active : l'API écrit toujours le `'default'` implicite et **ne filtre pas** par tenant en lecture (tous les approuvés voient tout — §5).
- **Interdits** : aucune table `clients`, aucune FK, aucune résolution de tenant depuis `account_users` (pas de colonne). Le multi-tenant réel = **lot AUTH séparé** qui, plus tard, (a) peuplera `tenant_id` réellement et (b) activera le filtrage. Le choix `TEXT` (vs UUID) est **délibéré** : il n'implique aucune table référencée.

### 3.4 Cohérence target_type ↔ ancre
Garantie par `chk_prospect_notes_anchor` (§2). `target_type='zone'` **n'existe pas** dans l'ENUM v1 (différé).

## 4. Cycle de vie — édition & suppression (décision i-arch)

**Décision : édition IN-PLACE (`updated_at`) + suppression SOFT (`deleted_at`).** (Confirmée owner/i-cond.)

- **Édition** : `UPDATE prospect_notes SET body=…, updated_at=NOW() WHERE id=…` (author-only). `created_at` immuable ; `updated_at` avance.
- **Suppression** : `UPDATE … SET deleted_at=NOW()` (author-only). Jamais de DELETE physique. Lecture filtre `deleted_at IS NULL`.

### Justification (pourquoi PAS la chaîne `supersedes` des tables sœurs)
Les sœurs `prospect_marks` (transitions d'état du pipeline) et `prospect_contacts` (**PII Loi 25**) sont append-only **parce que leur historique EST la donnée d'audit** (traçabilité des décisions ; traçabilité réglementaire des versions de données personnelles). Une **note libre** est du **contenu utilisateur mutable** : corriger une faute, préciser une note, retirer une note obsolète sont des gestes UX naturels (exigence produit D3 « éditable »), et l'historique de rédaction d'une note **ne porte pas** la même valeur d'audit ni de contrainte réglementaire. In-place + soft-delete est donc **plus simple et adéquat** pour cette classe de donnée, sans affaiblir aucune garantie d'audit existante.

### Alternative considérée et rejetée
**Chaîne append-only `supersedes`/`superseded_by`** (comme marks/contacts) : cohérence maximale avec la famille `prospect_*` + historique complet. **Rejetée pour v1** : coût d'API/impl supérieur (stamping transactionnel, unicité de chaîne active) sans le driver audit/réglementaire qui la justifie chez marks/contacts. **Réversible** : un besoin d'audit d'édition futur peut migrer les notes vers une chaîne supersede (les `updated_at`/`deleted_at` n'y font pas obstacle).

## 5. Autorisation (D2 team-shared, mono-client)

| Opération | Règle |
|---|---|
| **Lecture** (list/get) | Tout `account_users.status = 'approved'`. **Voit toutes** les notes non supprimées (mono-client → `tenant_id` non filtrant), **attribuées** (`author_id` + nom). |
| **Création** | Tout user approuvé. `author_id` = user de session (jamais un `author_id` arbitraire du body en prod — cf. §6). |
| **Édition** | **Author-only** : `author_id == session.user.id`. Sinon `403`. |
| **Suppression** | **Author-only** : idem. Sinon `403`. |

- Pas d'override admin en v1 (décision : author-only strict). Un override admin = décision de politique ultérieure, hors contrat v1.
- « approuvé » = `account_users.status='approved'` (0004). Les `pending`/`rejected` n'ont aucun accès annotations.

## 6. Contrat d'API (Hono + zod) — extension de l'existant

Base existante (à étendre) : `POST /api/v1/prospects/notes` (`prospect-marks.ts:205`), `addNote` (`marks-service.ts`), résolution auteur `resolveAuthorId(c, deps, body.authorId)`, frame SSE `publish(PROSPECT_STREAM_ID, "prospect:note", …)`.

### 6.1 Création — `POST /api/v1/prospects/notes` (étendu)
`createNoteSchema` (zod) devient une **union discriminée sur `target_type`** :
```ts
const noteBase = { body: z.string().min(1), mode: z.enum(["real","simulation"]).optional() };
const createNoteSchema = z.discriminatedUnion("target_type", [
  z.object({ target_type: z.literal("lot"),    no_lot: z.string().min(1), city_slug: z.string().min(1), ...noteBase }),
  z.object({ target_type: z.literal("signal"), signal_id: z.string().uuid(),
             no_lot: z.string().optional(), city_slug: z.string().optional(), ...noteBase }),
]);
```
- `author_id` = session user (`resolveAuthorId`). **En prod, un `author_id` de body est ignoré/interdit** (cf. §7 — durcissement de l'override dev-only).
- `tenant_id` **non exposé** au client (toujours `'default'` server-side).
- Réponse `201 { ok, note }` avec `note.author` (id + nom).

### 6.2 Lecture — `GET /api/v1/prospects/notes`
Query : `?target_type=lot&no_lot=…&city_slug=…` **ou** `?target_type=signal&signal_id=…`. Retourne les notes **actives** (`deleted_at IS NULL`) de l'ancre, **attribuées**, triées `created_at` desc. (Aucun filtre tenant en v1.)

### 6.3 Édition — `PATCH /api/v1/prospects/notes/:id`
Body `{ body: z.string().min(1) }`. Authz **author-only** (`403` sinon ; `404` si absente/supprimée). Écrit `body` + `updated_at`. Réponse `200 { ok, note }`.

### 6.4 Suppression — `DELETE /api/v1/prospects/notes/:id`
Authz **author-only** (`403`/`404`). Écrit `deleted_at`. Réponse `200 { ok }` (ou `204`).

### 6.5 SSE
Frames `prospect:note` étendues : `action ∈ {add, edit, delete}`, payload inclut `target_type`, `signal_id?`, `author`, `updated_at`, `deleted_at?`. Réutilise `PROSPECT_STREAM_ID`.

## 7. Durcissement de l'override `author_id` (dev-only)

L'existant `resolveAuthorId(c, deps, body.authorId)` accepte un `author_id` de body (fallback dev/simulation). Puisque **mutation = author-only** dépend de l'identité, le contrat exige : en mode authentifié (prod), l'identité de session **prime et l'override de body est refusé** ; l'override reste toléré uniquement hors session (dev/`simulation`). Extraction cadre l'exactitude avec l'implémentation auth existante.

## 8. Livrables extraction (implémentation sous ce contrat)

1. Migration `0011` (additive, 0 backfill, DEFAULT `'lot'`) — DDL §2.
2. Service `marks-service` : `addNote` étendu (target_type/signal), `editNote`, `softDeleteNote`, `listNotes(anchor)`.
3. Routes §6 (create étendu, get, patch, delete) + zod + authz author-only + SSE actions.
4. Tests : cohérence ancre (CHECK), attribution, author-only (403 cross-author), soft-delete invisible en lecture, 0-backfill (les notes 0005 restent lisibles en `target_type='lot'`), durabilité signal (`SET NULL` ne perd pas la note).

## 9. Traçabilité des décisions

| Réf | Décision | Source |
|---|---|---|
| D1 | Annotations = feature ouverte | owner |
| D2 | Team-shared (pas privé-par-user) : lecture tous-approuvés, attribuée ; mutation author-only | owner (re-tranché) |
| D3 | Éditable / supprimable | owner |
| D4 | Zones **différées** | owner |
| A | Mono-client : scoping forward-looking **inerte**, pas de multi-tenant réel, pas de table clients/FK | i-cond (mesuré : `account_users` plat) |
| i-arch | Édition in-place + soft-delete (vs supersede-chain) ; ancre signal `SET NULL` (durabilité) | ce contrat (§3.1, §4) |
