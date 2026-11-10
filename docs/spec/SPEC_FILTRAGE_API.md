# SPEC — Filtrage API des signaux (lots 0–2)

Statut : normatif pour les lots 1 et 2. Issue parente : #872.
Base factuelle : `tmp/conductor/filtrage-api-ORIENTATION.md` (option B, A d'abord).

## 1. Périmètre

Routes scopées existantes, inchangées hors ajouts additifs :

- `GET /api/v1/workspaces/:ws/signal-facets/by-city`
- `GET /api/v1/workspaces/:ws/signal-facets/coherent-city?citySlug&mode=signal`
- `GET /api/v1/workspaces/:ws/signal-facets/search` (existant, hors lot)

Aucune rupture : sans nouveau paramètre, le comportement est identique.
Les reader ops artefacts (`signals.by-city.v1`, `signals.coherent-city.v1`)
ne changent pas de contrat.

## 2. Paramètres de filtre (contrat fermé par sélection manuelle côté serveur)

Le contrat est fermé de fait par la sélection manuelle des champs dans
chaque handler (`z.object` ordinaire, sans `.strict()`) : seuls les
paramètres listés ci-dessous sont lus ; un paramètre inconnu est ignoré.
Exception : une valeur `view` hors de l'énumération `full|card` est
rejetée en 400 (nouveau paramètre énuméré du lot 1).

| Paramètre | Endpoints | Valeurs | Sémantique |
|---|---|---|---|
| `citySlug` | coherent-city, search | `^[a-z0-9-]+$` | Ville exacte |
| `view` | coherent-city | `full` (défaut) \| `card` | `card` = projection mince §3, sans enrichissement S3 |
| `dateFrom`/`dateTo` | by-city | `YYYY-MM-DD` inclusifs | Fenêtre sur la date effective §4 |
| `dateBasis` | by-city | `document` (défaut) \| `scrap` | Horloge de la date effective |
| `etape` (step) | search (existant), lot 3 | chaîne fermée | Étape du cycle — réservé lot 3 |
| `type` | search (existant) | `Signal` \| `DesignationEvent` | Type de nœud — réservé lot 3 hors search |
| `classification` (classement) | search (existant) | panier/archive | Voir `SignalQuery` existant — lot 3 |
| `archive` | search (existant) | `active` \| `only` \| `all` | Écartés — lot 3 (liste des écartés) |
| `excludePiia=1`, `excludeDerogations=1` | by-city | `1` | Exclusions d'affichage B |
| `showDiscarded=1` | by-city | `1` | Compte la population complète |

Lots 1–2 livrent uniquement `view` (lot 1) et le push SQL des dates
(lot 2, paramètres déjà existants). `etape`/`type`/`classification`/
`archive` en paramètres de `coherent-city`/`by-city` sont du lot 3.

## 3. Lot 1 — projection mince `view=card`

`coherent-city&view=card` renvoie la même enveloppe
(`ok, workspaceId, citySlug, mode, token, revisions, heads, selection,
signals, legacyProjection, counts`). Chaque signal porte :

- identité : `id, type, citySlug, label, sourceRef, facetFingerprint, createdAt`
- champs de carte : `description, publishedAt, etape, regulatoryStatus,
  classification, legacySubset, bPrime`
- `docRefs` dégradés (extraits des `props` persistés, **sans** appel S3) ;
  `evidence` construite sur ces refs dégradées
- `props` réduit à la projection fermée §5.4 déjà en production
  (`projectProps` de `reader-coherent-city.ts`, fail-closed)

L'UI charge la liste en `view=card`. Dégradation acceptée et bornée
(lots 1–2) : le panneau de détail affiche les `docRefs` dégradés sans
refaire d'appel `view=full` à l'ouverture ; les titres de documents et
`publishedAt` qui ne vivent que dans les métadonnées S3 ne s'affichent
pas dans ce chemin (`docTitle` retombe sur `sourceUrl ?? rawRef ?? docSha`,
le lien de preuve survit par ce repli). Le chargement `view=full` à la
demande reste le défaut historique hors liste et pourra être câblé à
l'ouverture dans un lot ultérieur sans changement de contrat.
La projection conserve les refs aux deux niveaux lus par la lentille
temporelle client : `refs` à la racine et `properties.refs` (même
projection bornée), pour que le filtrage par dates de la vue carte
suive `view=full`.

## 4. Lot 2 — date effective matérialisée (#872)

- Colonnes `graph_nodes.effective_document_dates text[]` et
  `effective_scrap_dates text[]` (dates civiles `YYYY-MM-DD`, dédupliquées).
  Les writers JS les calculent par `resultCivilDates(props, basis)` de
  `@radar/domain` (source autoritaire). Le backfill de la migration est
  un miroir SQL de cette sémantique : seconde implémentation à maintenir
  en parité (refs vides `{}` exclues, `fetchedAt` validé avant cast,
  ordre des clés d'étape imposé par ordinal). Tout écart futur du
  domaine doit être reporté dans le miroir, et réciproquement ; les
  writers corrigent la colonne à la prochaine écriture d'un nœud.
- Écrites par les deux writers graph (`upsertGraph`, projection atomique)
  à chaque écriture de nœud, à partir des `props` finaux persistés
  (y compris l'union des refs du chemin fraîcheur). Migration drizzle
  `0044_signal_effective_dates` + backfill SQL des lignes existantes.
  Aucun index GIN : le prédicat `EXISTS … unnest … BETWEEN` n'est pas
  servi par un index GIN sur `text[]` ; le gain vient de l'évitement du
  `props` complet des lignes hors fenêtre. Une table normalisée
  `(city_slug, node_id, basis, date)` + btree reste l'option d'évolution
  si la cible de latence n'est pas tenue à l'échelle.
- `by-city` pousse la fenêtre en SQL :
  `EXISTS (SELECT 1 FROM unnest(<colonne>) d WHERE d BETWEEN $from AND $to)`
  (borne absente = pas de borne). Le filtre JS historique reste appliqué
  en second passage sur le sous-ensemble déjà réduit : parité par construction.
  Note : le prédicat SQL compare les bornes en texte ; une date
  calendairement inexistante au format `YYYY-MM-DD` (ex. `2026-02-31`)
  passe le format des routes et donne un résultat vide des deux côtés.
- Aucune persistance ad hoc : colonnes du modèle graph existant.

## 5. Cibles de latence (serveur, hors transfert)

| Endpoint | Cible | Mesure de référence |
|---|---|---|
| by-city (fenêtre 7 j) | < 50 ms | ~3 s constat #872 ; SQL bulk 339 ms (orientation) |
| by-city (sans fenêtre) | < 100 ms — non livrée lots 1–2 | le chemin sans fenêtre lit toujours les `props` complets ; cible reportée hors périmètre |
| coherent-city ville (SQL) | < 10 ms | 2 ms mesurés (orientation) |
| coherent-city `view=card` | < 100 ms hors S3 | aucun appel S3 |
| coherent-city `view=full` | budget S3 2 s inchangé | `DOC_ENRICHMENT_BUDGET_MS` |

## 6. Jeu golden de parité

Compteurs `by-city` identiques avant/après lot 2, prouvés par test sur :

- Villes : `montreal-est` (plus grosse, 586 signaux), `valleyfield`
  (pilote), une ville sans signal, jeu synthétique des fixtures
  `signal-query-v1-*` (`ui/src/lib/signals/__golden__/`)
- Fenêtres : 7 jours, 90 jours, sans borne, `dateBasis=scrap`,
  fenêtre vide (aucune date dans l'intervalle), bornes inclusives
- Exclusions : `excludePiia`, `excludeDerogations`, combinées

Gate lot 2 : compteurs par ville identiques avant/après sur le jeu
golden, démontrés par le test engagé
`api/tests/filtrage-golden-parity.spec.ts` (chemin JS historique contre
`listCitiesWithSignalNodes`, 6 fenêtres × exclusions, `EXPLAIN` du
nouveau prédicat joint au rapport de lane). L'`EXPLAIN` à l'échelle
préprod (base `radar_next`, migration appliquée) reste à produire lors
de l'application en préprod ; la cible < 50 ms n'est pas démontrée à
cette échelle par les lots 1–2.

## 7. Règles owner appliquées

- Code générique dans les packages : le calcul de date vit déjà dans
  `@radar/domain` (`resultCivilDates`) ; aucun nouveau code générique
  créé côté API.
- Sérialisation : réponses reconstruites par allowlist (projection fermée
  existante), jamais de lignes brutes renvoyées.
- Aucune persistance hors schéma/migrations drizzle existants.
