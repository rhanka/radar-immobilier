# RAW specification — revue owner — 2026-08-12

> Status: raw owner input, recorded as initial intent. This is not an implementation contract. Architecture, privacy, authorization, data retention, and production rollout decisions remain to be specified and reviewed.

## 1. Release safety and infrastructure

Create a pre-production environment. Production rollout is allowed only after explicit owner validation.

Required capabilities:

- CI data-migration tests against production-shaped, sanitized fixtures;
- rehearsed migration rollback and application rollback;
- scheduled, tested production-data backups and restoration drill evidence;
- promotion evidence that separates pre-production acceptance from production authorization;
- production deployment must be a human-confirmed gate, not an automatic side effect of CI.

## 2. Collaborative annotation domain and UI

Specify and build the data model and views for annotations, selection basket, archiving, users, and collaboration. Reuse the current Sentropic comment model and integrate Sentropic comment and annotation modules rather than creating a parallel comment system.

### 2.1 Addressable targets

At minimum these objects can be annotated, selected, or archived: city, signal, zone, lot, and regulation. The target reference must be typed, stable, authorization-scoped, and version-aware where the underlying object is versioned.

### 2.2 Selection basket

A selection tag may be applied to an addressable target. It can carry an optional Markdown annotation, rendered and edited with TipTap. A basket can be private or shared with named users/groups according to the Sentropic collaboration model.

### 2.3 Archive / hide

Archive is a distinct state from selection. It hides or deselects a target and requires an annotation. It must support a personal archive and an explicit shared/all-users archive policy. Signal archive is a required first case. The UI must make the actor, scope, reason, timestamp, and reversal visible.

### 2.4 Annotations and threads

An annotation is a standalone typed note around one addressable target, optionally anchored to a selected/circled UI component. The anchored component becomes the comment target. Annotations can be followed and replied to by users using the Sentropic comment threading model.

Initial annotation types to validate during architecture: reported-data-problem, field-visit-report, validation-request, regulatory-follow-up, acquisition-lead, and internal-note.

Type taxonomy, retention, visibility, notification/follow policy, editing history, deletion, and audit obligations must be specified before implementation.

### 2.5 Chat and MCP feedback

Specify reintegration of the latest Sentropic `chat-ui` module.

Create an MCP feedback endpoint. The MCP must proactively surface missing data and detected problems, but submission of feedback must request explicit user confirmation. No autonomous user-visible feedback write is permitted. The endpoint and prompt contract need authorization, validation, audit trace, and confirmation-state rules.

## 3. Right pane

### 3.1 Signal evidence regression

Trace and restore the useful signal/PDF association previously displayed in the Signal right pane. Do not reintroduce unrelated field behavior as a substitute. Preserve evidence provenance and distinguish a source document from a regulation or zoning-grid PDF.

### 3.2 Search

Add search to lots and zones, equivalent in usability to city search in the left pane. Search behavior, ranking, keyboard navigation, result state, and empty state need component-level acceptance criteria.

## 4. Left pane

Investigate the defect where Saint-Stanislas appears when searched but is absent from the unfiltered city list. Trace the client/server filter, pagination, sorting, eligibility and visibility pipeline; fix the unintended filter and add a regression test based on the real city state.

## 5. Geographic view

- align the measure and legend controls vertically near the bottom of the map;
- replace the current layers glyph with a clear legend glyph;
- add a map/satellite mode control beside the measure tool, with the measure tool shifted left;
- satellite mode preserves selected lot/zone annotations but removes zoning area fills;
- define accessible labels, keyboard behavior, state persistence, attribution, source/licensing and graceful unavailable-tile state.

## 6. Data freshness and scheduled processing

Saint-Rémi is reported stale because recent minutes were not loaded. Specify and build a fully automatic daily Kubernetes CronJob refresh across the 1,000+ municipalities.

The specification must cover source scheduling, idempotency, rate limits, retry/backoff, pagination/sharding, locks, freshness watermark, source failure classification, observability, alerts, cost/capacity, manual replay, safe deployment, and production authorization. It must prove freshness outcome rather than merely that a job ran.

## 7. Regulations, norms, Geo→Immo→MCP contract

Clarify the regulation section end-to-end. It contains regulations and norms/zoning grids only; it must not display unrelated records such as municipal minutes.

Required work:

- fix the currently observed missing regulation rendering when a displayed signal is related to a Geo zone that has a real regulation number and URL;
- define typed data classes for regulation, regulation PDF/source, zoning grid/norms, and evidence document;
- specify collection, provenance, quality state, signal-to-zone relation, serving contract, presentation contract, MCP exposure, and error/absence states;
- preserve honest distinctions among no zone relation, no regulation, no URL, inaccessible URL, and unresolved relation;
- never use municipal-level coverage as proof that a signal has an associated regulation.

## 8. KPI remediation

Fix the already-raised KPI problems: regulation coverage, minutes/PV coverage, over-optimistic zoning collection coverage, Geo consistency; add a mean KPI with explicit denominator, excluded states, calculation and freshness timestamp.

Every KPI must expose its source, definition, denominator, measurement instant, confidence/quality state, and known exclusions. No KPI may label estimated or incomplete data as verified.

## 9. Environmental layers and user custom layers

Research useful environmental layers with a GPT-5.6 Sol xhigh deep-research pass, building on existing Geo research, then start with Warden jointly with Geo.

Candidate categories to evaluate, not pre-approve: flood zones; wetlands; protected areas and ecological constraints; hydrography / shoreland constraints; contaminated-land or other publicly lawful land-use constraints where suitable.

For each candidate, specify source authority, licence, update frequency, geography/CRS, resolution, coverage, known limitations, attribution, privacy implications, and value to the product.

Build the Geo pipeline so a user/agent request can add a custom layer for one city through MCP. Custom-layer data must be stored as a user layer, scoped to its owner/sharing policy, with provenance, authorization, quota/retention, review, rendering, and deletion behavior. A custom request must not silently become a shared canonical Geo layer.

## 10. Required planning and governance

1. Convert this raw specification into independently deliverable, parallelizable branch waves.
2. Obtain an independent GPT-5.6 Sol xhigh architecture pass from Immo architecture and a separate Geo architecture validation for cross-repository/data work.
3. Run a second independent Fable/Sol review; preserve disagreements and resolve them explicitly rather than blending them away.
4. Track each branch, dependency, acceptance criterion, ownership, and production gate.
5. Commit and review the converged plan; use PR and merge-commit workflow.
6. Create an H2A objective loop from the converged plan with explicit owners, dependencies, reporting cadence, and stop criteria.
7. Do not treat pre-production availability, CI green, or a merged PR as permission to deploy production.

## 11. Initial acceptance evidence

- pre-production exists and a human grants production promotion explicitly;
- a tested backup restore and migration rollback are evidenced;
- collaborative data remains scoped and auditable across users;
- right/left pane regressions have rendered regression proof;
- map controls meet the described behavior and accessibility checks;
- Saint-Rémi and the scheduled municipality refresh show measured freshness;
- regulation drawer is correct for a broad all-city audit and has a production-rendered Sutton regression proof;
- KPI definitions and values are reproducible;
- Warden environmental-layer pilot has source/provenance evidence;
- custom MCP-created layer remains a user layer unless explicitly promoted.
