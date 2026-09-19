# Astra medium with Gemini low verification: acceptance and promotion

Prepared policy based on the v101b precision cascade; this document is not a deployment receipt.
Primary: `openai / gpt-6-astra / medium`, with two quality attempts under contract v9.
Fallback: `gemini / gemini-3.8-flash / low` after persistent quality refusal, or immediately
after transport, quota/429, timeout, or empty output. Fallback affinity persists for the document.
`REFRESH_FORCE_FALLBACK=1` bypasses Astra.

`REFRESH_VERIFY_ENABLED=1` adds one verification pass after each accepted primary chunk,
before durable completion. The three model variables are `REFRESH_VERIFY_PROVIDER=gemini`,
`REFRESH_VERIFY_MODEL=gemini-3.8-flash`, and `REFRESH_VERIFY_REASONING_EFFORT=low`.
Fallback outputs skip verification and record `verification.status=skipped-fallback`.
Set `REFRESH_VERIFY_ENABLED=0` on the workload to disable verification without an image rebuild;
this changes the durable policy identity and requires no purge.

The frozen instruction lives in `api/src/services/graph/refresh-verification-prompt.ts`,
SHA-256 `cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68`.
Acts are connected groups of `Signal`, `DesignationEvent`, and `Bylaw` linked by `raises_signal`.
Only explicit `non_soutenu` with a non-empty reason removes a group's nodes and every edge
whose source or target is a removed node, exactly as `precision-cascade.mjs` does.
Other nodes, surviving edges, evidence, and metadata remain unchanged. No new or modified
graph content is accepted. Durable policy contract `v101b-removal-only-v3` isolates earlier
outputs produced before the edge rule and the verifier envelope were aligned on the benchmark,
without deleting them.

Missing or invalid decisions keep acts (`kept_no_valid_decision`). Unknown IDs are ignored
and counted (`unknown_ids`); a primitive or null decision entry names no act and is skipped
without being counted, as in `precision-cascade.mjs`. Grounding is the benchmark predicate:
at least 20 Unicode code points and a normalized match inside one physical page of the chunk.
A supported act whose excerpt fails it is kept and counted (`supported_ungrounded`); an
unsupported act whose contradicting excerpt fails it is removed and counted
(`contradicting_excerpt_ungrounded`). Grounding feeds counters only and never removes an act.
A chunk with no act triggers no verifier call and records `verification.status=skipped-no-acts`.
The verifier answer is parsed like the benchmark: a code fence and prose around a single JSON
object are tolerated, and a scalar, null, or array answer is a parse failure rather than an
empty decision list. Invalid JSON or verifier failure keeps the accepted extraction.
Verification failure triggers neither an extraction fallback nor a verification retry.

Each `documentModels[docSha][]` receipt carries model, invocation ordinal, latency, status,
transition (`primary`, `same-model-retry`, `fallback`, `verification`), and safe counters.
Verifier failures are excluded from restored fallback affinity and quota accounting.
The circuit routes directly to Gemini after three consecutive quota-failed documents.
The durable budget reserves four calls per chunk when verification is enabled, three otherwise.
Completed chunks resume without another extraction or verification call.

Migration `0012_refresh_document_outcomes` adds the dedicated `refresh_document_outcomes`
table to the configured `radar` PostgreSQL database, with creation-date and status indexes.
Apply it through the existing database migration procedure before starting the new Job image.
One INSERT records each document submission's terminal result (`accepted` or `refused`),
including all new chunks, retries, and verification calls; cache-only resumes insert nothing.
An explicit retry appends a new row without changing prior results. `created_at` is submission
time; `cycle_id` identifies the invocation. `page_count` comes from the parsed document.
Model/transition describe the last extraction attempt, not the verifier. `failure_reason` is
the latest failed call's class (possibly on an accepted fallback or preserved primary result);
`fallback_reason` records the extraction switch. Counters aggregate this submission only.
References are SHA-256 digests; no URL, document text, excerpt, upstream error, or credential
is stored. Legacy `ingestions` and `documents` are not involved.

The schema also permits `submitted`, but the current writer inserts only final results to
preserve the one-row, append-only contract. A process kill before that INSERT or an unavailable
PostgreSQL server can leave no outcome; there is no transactional outbox or crash reconciliation.
An INSERT failure fails the cycle. An accepted extraction does not assert publication success.

The edge rule, page-level grounding, the contradicting-excerpt counter, JSON parsing
tolerance, primitive-decision handling, the zero-act skip, and the message body now match
`precision-cascade.mjs`. Replaying the 100 archived astra-medium outputs and the archived
verifier answers through this code reproduces the benchmark act by act: 912 acts, 229
removals, zero difference in either direction, and identical counters (see
`.remote/CONVERGENCE_BANC_RUNTIME_STATUS.md`).

Three differences remain for conductor decision. The verifier instruction travels as the head
of the single `prompt` string instead of a separate system message, because the text/JSON port
exposes no system field, and the mesh client prepends its own generic system message and a
`Schema:` line. The identity line carries the document SHA-256 and the city but no meeting
date, which the corpus does not hold. Verification is scoped to the accepted chunk rather than
the whole document; on this benchmark corpus the two scopes coincide, because every one of the
100 documents is single-chunk by construction. `contradicting_excerpt_ungrounded` lives in the
S3 receipt only; `refresh_document_outcomes` does not project it.

## Validation préproduction (lane k8s)

1. Après fusion par i-cond et CD préproduction, relever SHA, digest immuable, deux enrôlements sous le même owner scope, PVC inscriptible et CronJob PV seul actif. Aucun Secret ni octet de keyring ne va dans les preuves.
2. Run the authorized cycle without overlapping the scheduled CronJob. The new durable policy identity separates prior results; no refresh-state purge is required.
3. Archive safe receipts: model, attempts, transitions, primary quality retries, Gemini fallback, quota/429, verification status/counters, and published B′ signals. Distinguish verifier failures that preserved the extraction from completed verification.
4. Vérifier les liens de signaux B′ sur `https://preprod.immo.sent-tech.ca/…`, les documents scrapés et les six étapes durables (corpus, profil, candidate, enriched, published, projected). Consigner les documents publics effectivement traités et leurs URLs, sans sélectionner a posteriori selon le résultat.
5. Separately exercise `REFRESH_FORCE_FALLBACK=1`: Gemini low, `transition=fallback`, `fallbackReason=forced`, `verification.status=skipped-fallback`, zero Astra and zero verification calls. Also exercise `REFRESH_VERIFY_ENABLED=0`: no verifier call and `verification.status=disabled`. Neither replaces normal-cycle acceptance.

## Promotion production

1. Avec le GO owner, confirmer les mesures préproduction, les enrôlements et le digest exact.
2. Positionner la variable GitHub `REFRESH_CRONJOB_PROD_ENABLED=true`, créer le tag `v*` sur le commit fusionné et approuver la porte production selon le workflow.
3. Verify the production render: PV active, other CronJobs suspended, Astra medium with two quality attempts, Gemini low fallback and verification enabled. Keep the 768Mi workload / 512Mi heap guard. Run the authorized Job and archive the same measures and `https://immo.sent-tech.ca/…` links.

## Retour arrière

Disabling verification affects future executions; it does not restore previously removed nodes.

Suspendre d'abord le CronJob PV et traiter le Job actif. Restaurer ensemble le digest et la politique précédemment acceptés, puis remettre `REFRESH_CRONJOB_PROD_ENABLED` à sa valeur antérieure si nécessaire. Une image restaurée ne restaure ni état S3 ni projection PostgreSQL : employer uniquement la sauvegarde canonique et le reçu d'application approuvés pour récupérer des données.
