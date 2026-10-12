# Annotation legacy eradication and operational adoption

## Baseline and authority

Inventory baseline: immo `ea90951c`; implementation: `feat/annotations-host`.
The owner ordered eradication on 2026-10-10, ratified the inventory/order on
2026-10-11 (D3), and selected no recovery of deleted notes plus existing backup
expiry (D4). The later cluster-mesh decision supersedes local canonical hosting.
See [host specification](SPEC_EVOL_ANNOTATIONS_HOST.md) for exact M1 provenance.

## Inventory

| Surface | Branch disposition | Qualification |
|---|---|---|
| Drizzle `prospectNotes`, exclusive target enum and schema export | Removed | API/domain typecheck |
| Domain `ProspectNote`, input schemas and note tests | Removed | Retained domain suite |
| Prospect note POST/GET/PATCH/DELETE and lot notes GET | Removed, no shim | Every old endpoint returns 404 |
| Service note types, reads, creates, in-place edits and soft deletion | Removed | Marks/contact integration remains |
| `prospect:note` publishers and attributed body frames | Removed | No active publisher or UI subscriber |
| UI private model, client, subscription and their tests | Deleted | Targeted UI tests/typecheck |
| Signal/lot annotation components, badges, counts and callbacks | Deleted | Retained panels and marks tests |
| Lot `Promise.all` marks+notes | Deleted; fetch marks directly | Retired notes cannot fail mark loading |
| MCP dormant `immo:notes:write` and scope promise | Removed | MCP typecheck |
| QA lot/signal harness entrypoints | Inspected; no note-specific consumer on this baseline | Relevant panel tests/build |
| Historic 0005/0011 SQL | Preserved unchanged | Expected bytes/checksums compared with native receipts |
| Physical `prospect_notes` and its exclusive enum | Guarded separate retirement after schema installation | Fresh and deleted-only cases pass; active case refuses |
| Former annotation/Steve/MCP specs and reports | Explicit supersession notices | History and owner quotations preserved |
| Old replicas, memory SSE buffers, browser assets | Operational drain/restart/reload required | Not a deployment executed by this branch |
| Existing backups | Existing expiry only, no new copy of legacy notes | Restore qualification required before operational adoption |
| Track items CS-L2/3/4, CS-P3 | Conductor reconciliation remains | No inferred completion of old backlog items |

Marks, contacts/access journal, accounts, lots, documents and chat have their own
purposes. No note body is relocated into them. Historical SQL and retirement
regression tests may name the legacy; zero active consumers is the code criterion.

## Installed host and migration guard

`0014_annotations_host.sql` creates only explicit immo assignment/resource metadata.
No default tenant, workspace, memberships or capabilities are seeded.
The host runner reads the entire SQL inventory, including the known unjournaled
0009, and applies assets in numeric order rather than relying on max(timestamp).
It compares every applied checksum, refuses missing predecessors/drift, records
an attached extension, and serializes DDL/cutover with one advisory lock.
Each DDL step commits independently before the separate retirement transaction.

An existing 0009 schema without a qualified native receipt is refused before
mutation. This branch does not silently run the historical backfill or invent an
attestation. Immo must provide a catalog-verified controlled attestation before
adopting on such a database. A fresh isolated installation executes 0009 normally.

The migrator's final retirement takes an exclusive table lock and counts active
and deleted rows without extracting deleted bodies, authors or identifiers.
Any active row refuses retirement and release; the already installed host schema
remains available for subsequent qualified conversion. M1 alone cannot prove that
conversion: its import DTO has no payload channel and its unit receipt does not
yet list every canonical result needed for reconciliation.
Empty/deleted-only retirement drops the table/type without CASCADE and atomically
retains only the aggregate deleted count. Retry preserves that count. Applied
history never re-creates the table; drifted historical restores are refused.

## Operational sequence

1. Sentropic delivers the exact M2/M3 cluster-mesh module, storage/migration assets,
   router, payload/service import interface and complete typed result receipts.
2. Immo qualifies retained artifacts, authenticated principal binding, resource
   versions, full multi-target access, atomic import/replay and exact readback on
   synthetic inputs. A changed snapshot needs explicit linked conversion.
3. Before any real Steve inscription, obtain Farid D5/D6, apply required redaction
   before hashing and prove real resource/team assignments. Preserve unknown
   documentary authors/dates; importer identity is never Steve attribution.
4. Before the authorized cutover, close admissions, stop legacy producers and
   all incompatible refresh/worker/MCP workloads, drain old SSE replicas, and
   reload old browser assets. Do not create a new legacy backup.
5. Install host/module schemas under the same migration authority. Convert active
   notes via the shared service in recoverable atomic units; exclude deleted
   notes individually. Compare frozen manifest, exact result IDs/hashes/chains,
   receipts and source dispositions before allowing active-note retirement.
6. Retire in a separate guarded transaction, then reopen only canonical consumers.
   Retired legacy UI remains absent; new UI does not gate Steve import.
7. Prevent rollback/promotion/restore from serving an old writer or restored legacy
   table. Restart only after qualified conversion/retirement; existing backups
   expire normally. Complete source corpus import and legacy retirement remain
   separate acceptance results.

## Bounded remaining handoff

Sentropic owns M2/M3: observable acceptance is a delivered module installed from
retained exact artifacts that commits one synthetic source unit atomically,
returns recoverable complete typed receipts, supports exact authorized readback,
and refuses spoofed principal/stale resource/version/replay. Immo then enables
active-note conversion/retirement and qualifies deployment/restore consumers.
This branch implements the host seams and refusal guards; it does not claim that
M1's declared factory is a delivered canonical runtime or that Steve was injected.
