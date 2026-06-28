# WP6 — Branchement des agents remote → Track/projection (via h2a)

> But : permettre à N agents remote (scraping/graphify/geo en background) de pousser
> leur avancement dans la structure de suivi, SANS casser l'invariant single-writer
> du sidecar `.track` ni la règle d'honnêteté (AWAITED done non signé = needs_review).

## 1. Invariants à respecter (vérifiés dans le code Track 0.19.2)
- **Single-writer** : `.track/events.jsonl` est append-only, un seul writer (aujourd'hui
  100% `prov=(local-user, cli)`, by humain). Un agent remote ne doit JAMAIS écrire le
  sidecar canonique directement.
- **Workspace containment** : tout write est épinglé à un workspace (ingest `--workspace`).
- **Binding gate** (`src/ingest/ingest.ts:54`) : les écritures *settling*
  (`item.realize`→done/cancelled, `acceptance.run`, `blocker.resolve`,
  `decision.outcome`, `acceptance.waive`) exigent un canal **authentifié**
  (`auth ∈ {local-user, signed}`). Les écritures non-bloquantes
  (`item.create`, `item.spec`, `acceptance.criterion`, `item.reparent`…) sont ouvertes.
- **Idempotence** : l'ingest dé-duplique sur `(workspace, clientToken)` → un agent peut
  rejouer son rapport sans doublonner.

## 2. Architecture cible (seam = `track ingest`, médiation = h2a)
```
 agent remote (worktree isolé)                conducteur / canal signé        sidecar canonique
 ─ produit WorkEvents JSONL  ──[h2a journal/ATTENTION]──►  track ingest  ──►  .track/events.jsonl
   (item.create / realize:in-progress /        --workspace <wp-slug>           (single writer)
    acceptance.criterion / blocker.raise)      (auth local-user|signed)              │
                                                                                     ▼
                                                                          projection (wp6-projection.py
                                                                          / api track-reader) → kanban
```
- **Pourquoi h2a** : h2a porte la coordination inter-agents (sessions, journal signé,
  négociation). Le rapport d'avancement d'un agent remote = une entrée de journal h2a
  (`h2a_append_journal`) ou une ATTENTION ; un **writer désigné** (WP6/conducteur, ou
  un canal `signed` via `h2a_sign`) la convertit en WorkEvents et `track ingest`.
- **Honnêteté préservée** : un agent remote NON signé ne peut PAS settler `done`
  (binding gate) → son « terminé » entre comme **claim non-bloquant** ⇒ l'item reste
  `needs_review` jusqu'au signoff conducteur (`acceptance.run pass` / `decision outcome`).
  Avec M3 (`auth:'signed'`), un agent remote de confiance signé par h2a peut settler.

## 3. Contrat WorkEvent que l'agent remote émet (JSONL)
Un agent remote ne connaît que SON workspace et ses items. Exemple `progress.jsonl` :
```jsonl
{"kind":"item.realize","itemId":"01K…","to":"in-progress","clientToken":"agentA-scrape-stdamase-001"}
{"kind":"acceptance.criterion","itemId":"01K…","statement":"PV St-Damase 2024-04-02 scrapé + raw S3","clientToken":"agentA-scrape-stdamase-002"}
{"kind":"blocker.raise","target":"01K…","blockerKind":"dependency","reason":"403 WAF — Obscura requis","clientToken":"agentA-scrape-stdamase-003"}
```
Ingest (writer désigné, depuis la racine) :
```bash
track ingest progress.jsonl --workspace wp1-data
```
- `clientToken` stable par étape ⇒ rejouable/idempotent.
- `item.realize done` et `acceptance.run` seront REFUSÉS si le canal n'est pas
  authentifié ⇒ l'agent reste en `in-progress`/`needs_review`, jamais « fait » en silence.

## 4. Stub livré
`wp6-remote-agent-stub.mjs` : génère un `progress.jsonl` d'exemple pour un agent remote
(paramétrable workspace/item), prêt à `track ingest`. Démontre le format + la dédup.

## 5. Étapes d'implémentation (todo WP6/WP5)
1. **Relais h2a→ingest** : un petit service (côté conducteur) qui lit les journaux h2a
   des agents enregistrés (`h2a_discover_instances`/`h2a_inbox`), mappe vers WorkEvents,
   et `track ingest --workspace <slug>` (canal `local-user`). 1 todo WP6.
2. **Canal signé** : brancher `h2a_sign` → `prov.auth='signed'` pour autoriser les
   agents de confiance à settler (M3). 1 todo WP5 (sécurité) + WP6 (politique signoff).
3. **Workspaces agents** : chaque agent remote écrit dans le slug WP de sa mission
   (wp1-data pour scraping, wp2-extraction pour graphify). Pré-requis : la migration
   item→workspace WP (cf. patch-plan `item reassign-workspace`, wp6-socle-status.md),
   sinon l'agent écrit dans le workspace hérité et la projection WP s'applique en lecture.
4. **Projection live** : la route API kanban (étape 5) lit le sidecar foldé + la
   projection WP → le kanban montre l'avancement remote en quasi temps réel (poller).
5. **Garde-fou anti-corruption** : aucun agent remote n'écrit `.track` ; tout passe par
   l'ingest du writer désigné (respecte la mémoire projet « agents = worktree isolé »
   et « sole Track writer »).
```
