---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 4583ac5e1cd060aef6625abf0a6c9c0e27f83cb7
legs: []
observed-failure: Exact declared author model and effort are absent from the launch brief; the harness complementary selector cannot run without them.
---

# Annotations host verification and review

## Code verification

The target is the committed immo host implementation and complete legacy consumer
removal. Code and all retained artifacts are in `feat/annotations-host`; no real
data, deployment, root UAT checkout or remote team messages were changed.

| Verification | Observed result |
|---|---|
| Exact source/archive checksums and producer vector bytes | Pass |
| Rebuild M1 from retained source and build lock without producer checkout | Byte-identical npm archive |
| Scoped host, route, resource/version/provenance tests | 12 passed |
| PostgreSQL assignment/migration/retirement and retained route tests | 24 passed |
| Full API, four workers, isolated test stack | 2,248 passed; 6 existing skips |
| Full UI | 1,624 passed; 10 existing todos |
| Domain / scoring / MCP / sources | 64 / 289 / 57 / 1,293 passed |
| Workspace typecheck | Pass; seven Svelte warnings |
| Changed-file and full workspace lint | Pass |
| API/UI build and API production image build | Pass; M1 builders and retirement entrypoint load in image |
| Production UI server-runtime bundle smoke | Pass |
| Harness branch and full path inventory scope checks | C1/C2 pass |
| Whitespace/diff integrity | Pass |

The first unrestricted full API run exposed a historical fixture that removed
0013 alone but retained the new 0014: Drizzle's timestamp selection skipped 0013.
The fixture now explicitly bounds its snapshot at 0012. The same run had
connection/test timeouts under concurrent builds; full API qualification with
four workers passed, without increasing any timeout or weakening an assertion.
UI/package suites from that campaign passed. Harness emits advisory output with
a placeholder clock; the actual Make runs above are the execution evidence.

## Review status

Two independent blind design reviews covered contract correctness and
eradication/security; their accepted findings are recorded in the host spec.
They are not a completed complementary code consensus review.

The installed `harness-review/SKILL.md` requires exact author host/model/effort
and says: **"Unknown author means no acceptable review"**. Its selector must
retain two distinct complementary host/model candidates before dispatch through
h2a. Exact author model/effort were not supplied, so selection stops here;
no review leg was dispatched and no consensus verdict is claimed.

To complete that review, provide the actual declared launch metadata for this
author and select two reachable complementary candidates against the exact target.
Operational adoption separately requires the qualified cluster-mesh M2/M3 module,
typed import/readback receipts, real assignments and Farid D5/D6, as detailed in
[the eradication handoff](ANNOTATIONS_ERADICATION.md).
