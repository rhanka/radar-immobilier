# SPEC_EVOL — ÉV5 h2a coordination + chat — brief

> **Status**: EVOL — évolution ÉV5 (`feat/h2a-spike-chat`). Spike-first (done — see escalations
> SPIKE RESULT/D13/D14). Parent `SPEC_EVOL_PROCESS_E2E.md` §5/§11 + `SPEC_EVOL_OPERATING_MODEL.md`.
> English code; French UI. Type-only imports.

## 1. Spike outcome → decision
`@sentropic/h2a` (0.8.0) + `@sentropic/flow` (0.1.1) exist but are **Node-oriented** (crypto/journal);
socle §11 defers crypto for V1. → **V1 = a decoupled coordination interface in the UI** mirroring
h2a's concepts (Role / POLICY / append-only journal), **no external dep, no crypto, in-memory**.
A real server-side h2a adapter is deferred (escalation logged).

## 2. Goal
A **"Coordination" (chat) demo view**: shows the human↔agent coordination model — the **role label**
(PRINCIPAL = human, never the AI), a **POLICY** summary (decision-support not advice; anti-cheat:
no fabricated data; OACIQ/Loi 25 disclaimer), and a **journal of decisions** that grows as the human
(PRINCIPAL) issues instructions via a stub chat. Makes §5/§11 tangible for the UAT.

## 3. Scope (default decisions D13/D14)
- **Coordination interface** (pure, `ui/src/lib/coordination/`):
  - `Role = "principal" | "conductor" | "agent"` + French labels; PRINCIPAL is always a human.
  - `Policy` = `{ id, title, rules: string[] }` — a default `radarPolicy` (decision-support not advice;
    no fabricated/non-disponible-as-favourable data; courtage OACIQ boundary; Loi 25 PII masking).
  - `JournalEntry = { id, who, role, action, at, note? }` (mirrors the @radar/domain JournalEntry shape)
    + an in-memory append-only `createJournal()` returning `{ entries, append(entry) }` (no UPDATE/DELETE;
    corrections via a new entry). No persistence (matches ÉV1 deferral).
  - Helpers: `appendDecision(journal, {who, role, action, note})`, `summarizePolicy(policy)`.
- **"Coordination / Chat" view** (`ui/src/lib/components/coordination/CoordinationView.svelte`):
  - Header: role label badge (PRINCIPAL = humain) + a note "L'IA n'est jamais PRINCIPAL" (socle §11).
  - POLICY panel: the default radar policy rules, each as a line.
  - Journal panel: the append-only decision log (who/role/action/at), newest last.
  - Chat composer (stub): the human types an instruction → it is appended to the journal as a
    PRINCIPAL decision; a **canned assistant turn** (CONDUCTOR, labelled "réponse simulée — pas de LLM")
    acknowledges. No real LLM/network call. Reuse the `@sentropic/chat-ui` ChatPanel pattern if clean,
    else a simple panel.
- **Wiring**: new `DemoView "coordination"` in NavMenu (after opportunity/grilles) + App.svelte branch.

## 4. Acceptance
1. The coordination interface exposes Role/Policy/Journal + append-only journal (a correction is a new
   entry, never an in-place edit) — unit-tested.
2. The view shows the PRINCIPAL=human role label + "l'IA n'est jamais PRINCIPAL", the default POLICY rules,
   and the journal.
3. Typing an instruction appends a PRINCIPAL decision to the journal + a clearly-labelled simulated
   assistant turn (no real LLM). Tested at the helper level.
4. Wired as a demo view; other views intact; gate green (typecheck/lint/test-ui/build).

## 5. Out of scope (deferred — escalation)
Real `@sentropic/h2a`/`@sentropic/flow` integration (signed ENGAGEMENT/MANDATE, ed25519, persistent
journal, server-side coordination), real LLM chat, multi-human modes — all deferred to a server-side
build, logged for UAT.
