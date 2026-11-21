# Spec — Annotation Trust, Validation Statuses and Feedback Model

- **Status**: Draft (awaiting owner GO on Engram ontology `rhanka/engram` branch `spec/annotation-trust-feedback`, `spec/SPEC_ONTOLOGY_ANNOTATION_TRUST_AND_FEEDBACK.md`).
- **Scope**: Alignment of `radar-immobilier` signal classification, provenance, and feedback tables/APIs/UI on the Engram annotation trust & feedback ontology.
- **Refs**: `#1164`.

---

## 1. Origins (actor & channel)

Every signal classification carries an explicit origin and channel:

| Engram origin | Channel | Actor identity | UI badge |
|---|---|---|---|
| **AI** (`ai`) | Batch / refresh pipeline (`reannotate-signals`, `refresh-pv`) | `model`, `effort`, `prompt_id`, `prompt_sha256`, `pipeline_run_id`, `input_sha256` | `IA [· ambigu] · <model> <effort> · prompt <promptId> · <YYYY-MM-DD>` |
| **Manual UI** (`manual` / UI) | Authenticated immo browser (`SignalClassementMenu`, `SignalClassFeedback`) | `actor_id` (`account_users.id`), `workspace_id`, `created_at` | `Manuel` (ou `Validé par un humain` / `Reclassé par un humain` sur feedback) |
| **Human via MCP + elicitation** (`mcp+elicitation`) | Authenticated MCP OAuth + accepted `elicitInput` | `actor_id`, `oauth_sub`, `client_id`, `model`, `elicitation_id`, `elicitation_accepted_at` | `Humain · via MCP + élicitation` |
| **MCP auto** (`mcp`) | Authenticated MCP OAuth without accepted elicitation | `actor_id`, `oauth_sub`, `client_id`, `model`, `created_at` | `MCP · <model> · validé auto` (ou `à confirmer` si `pending_human=true`) |
| **Historical import** (`manual` / import) | Governed insert-only reprise (`chaperon-reprise-apply`, UUIDv5 `command_key`) | `owner_id`, `actor_id`, `workspace_id`, `created_at` | `Manuel` |

### Dual visibility rule (owner decision 2026-11-21)

- A signal keeps **both** its human class and its AI class visible (model, effort, prompt, date, reason).
- The human class always wins for filtering, sorting, and the active classement icon.
- An untouched `Non classé` signal (no human class, no AI class, no MCP class) displays **no** `Manuel` badge.

---

## 2. Trust and validation statuses

| Status | Meaning | Eligible origins |
|---|---|---|
| `unvalidated` / `auto` | Machine-proposed class not yet validated by a human | `ai`, `mcp` (without accepted elicitation) |
| `uncertain` / `ambiguous` | Machine-proposed class flagged uncertain (`ambiguous = true`) or marked uncertain by feedback | `ai` (`ambiguous = true`), feedback `uncertain` |
| `needs-elicitation` | Proposed through MCP and awaiting explicit human confirmation | `mcp` (`pending_human = true`, `validation = 'auto'`) |
| `human-validated` (`human`) | Confirmed or decided by an identified human | `manual` (UI / import), `mcp+elicitation` (accepted elicitation), browser `decideSignalMcp` |
| `human-rejected` | Explicitly rejected/discarded by a human with a mandatory reason code (`N-*` / `ecarte`) | `manual` (UI / import), `mcp+elicitation` |

---

## 3. Feedback types (aligned on Engram ontology)

| Feedback type | Semantics | Required fields | Resulting status |
|---|---|---|---|
| `confirm` | Human validates the proposed AI/MCP class as-is | `actor_id`, `target`, `judged_annotation_id` / `linked_event_id`, `created_at` | `human-validated` (`validation = 'human'`) |
| `correct` | Human replaces the proposed class with another active class (`pertinent`, `a_surveiller`, `non_classe`) | `actor_id`, `new_classe`, `reason_code` (registry), `reason` | `human-validated` (`validation = 'human'`) |
| `reject` | Human rejects/discards the signal (`ecarte` / `non_pertinent`) with mandatory reason | `actor_id`, `reason_code` (`N-*`, mandatory), `reason` | `human-rejected` (`validation = 'human'`) |
| `uncertain` | Human or AI marks the classification as uncertain / needs review without discarding | `actor_id` (or `ai` `ambiguous=true`), optional `reason` | `uncertain` |
| `needs-elicitation` | Automated MCP proposal requests explicit human confirmation before acquiring human authority | `actor_id`, `oauth_sub`, `client_id`, `model` | `needs-elicitation` (`validation = 'auto'`, `pending_human = true`) |

---

## 4. Forbidden transitions (invariants)

1. **AI never self-validates**: no pipeline (`refresh-pv`, `reannotate-signals`) and no unelicited MCP call may write `validation = 'human'` or `source = 'manual'`.
2. **Human rejection is never overwritten by AI**: once a human `reject` (or any human `confirm` / `correct` in `facet_events` or `signal_mcp_events` with `validation = 'human'`) exists, neither AI refresh/reannotation nor unelicited MCP (`auto`) may supersede or overwrite it.
3. **Human origin requires verified identity**: `actor_id` and (for MCP) `oauth_sub`, `client_id`, `elicitation_id`, and `elicitation_accepted_at` must come from server-verified auth/elicitation, never from tool arguments.
4. **Immutable audit trail**: all feedback, manual facet events, AI annotation history, and MCP events are strictly append-only (no `UPDATE`, `DELETE`, or `TRUNCATE`).

---

## 5. Mapping of current Radar tables to ontology concepts

| Current table | Role today | Current columns mapped to ontology | Gap to close in PR A (after Engram GO) |
|---|---|---|---|
| `signal_class_annotations` (`0045`–`0047`) + `signal_class_annotation_history` | Global AI classification state + immutable AI history | `source='ai'`, `classe`, `reason`, `ambiguous` (`uncertain`), `model`, `effort`, `prompt_id`, `prompt_sha256`, `pipeline_run_id`, `input_sha256`, `updated_at` | `readClassAnnotations` previously masked AI rows when `facet_events` had `manual` → keep AI row readable alongside human class. |
| `facet_events` (`0014`, `0045`, `0047`) | Scoped append-only UI + Chaperon import human stream | `source='manual'`, `scope`, `workspace_id`, `owner_id`, `actor_id`, `facet` (`selection`/`archive`), `basket`, `state`, `reason_code`, `command_key`, `class_feedback_id`, `created_at` | Represents `manual` UI & import (`confirm` / `correct` / `reject`). No schema change required for existing streams; UI must not label untouched `non_classe` as `Manuel`. |
| `signal_class_feedback` (`0047`) | Append-only UI feedback on AI annotations (👍/👎) | `verdict` (`up` → `confirm`, `down` → `correct`/`reject`), `judged_class`, `human_class`, `reason_code`, `annotation_id`, `event_id`, `actor_id`, `workspace_id`, `created_at` | Expand `feedback_type` taxonomy (`confirm`, `correct`, `reject`, `uncertain`, `needs-elicitation`) once Engram ontology is finalized. |
| `signal_mcp_events` + `signal_mcp_audit` (`0048`) | Scoped append-only MCP journal + audit | `source` (`mcp`/`manual`), `validation` (`auto`/`human`), `pending_human` (`needs-elicitation`), `verdict`, `linked_event_id`, `actor_id`, `oauth_sub`, `client_id`, `model`, `created_at` | Migration `0049`: add `source_tag` (`mcp` / `mcp+elicitation` / `manual`), `elicitation_id`, `elicitation_accepted_at`, `elicitation_status`; allow `validation='human'` with `source_tag='mcp+elicitation'` on accepted elicitation. |

---

## 6. Next steps (gated)

1. Review & owner GO on `rhanka/engram` `spec/SPEC_ONTOLOGY_ANNOTATION_TRUST_AND_FEEDBACK.md` and this Radar spec.
2. Align any renamed enum values or feedback columns (`feedback_type` in `signal_class_feedback` / `signal_mcp_events`) in PR A (`#1169`, currently Draft) before marking it ready for review.
