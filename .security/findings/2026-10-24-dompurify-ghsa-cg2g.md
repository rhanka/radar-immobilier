# DOMPurify sanitization vulnerabilities (GHSA-cg2g-xh64-v4q7)

- Status: fixed dependency resolution in the root workspace and `docs/architecture/focus` (DOMPurify 3.4.17)
- Severity: critical for [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7); high for [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr)
- Published: 2026-10-22; detected and remediated: 2026-10-24
- Affected: critical `>=3.4.4 <=3.4.16`; high `<=3.4.16`; patched version: `3.4.17`
- Owner: repository owner

## Affected and exposure

- Root installed path: `node_modules/dompurify`, originally 3.4.16. Dependency path: `ui` → `svelte-streamdown@3.0.1` → `mermaid@11.17.2` → `dompurify`; `@sentropic/chat-ui@0.33.0` also uses the deduplicated Streamdown package.
- The UI's `RapportView.svelte` renders report Markdown through Streamdown. Its `controls.mermaid: false` configures controls; this is not evidence that Mermaid or sanitization is unreachable.
- Focus has a direct DOMPurify dependency and a Mermaid dependency sharing `node_modules/dompurify`.
- Additional artifact boundary: Mermaid's `dist/mermaid.min.js` embeds DOMPurify 3.4.12. Focus previously read this runtime directly, so updating its dependency alone would leave affected sanitizer code in use. The npm dependency audit does not cover this embedded copy.
- Actual exploit exposure: **unverified**. The package paths are established; no exploit, attacker-controlled input path, or use of the advisory-specific DOMPurify options/hooks was demonstrated.
- The critical advisory concerns `SAFE_FOR_TEMPLATES` and attached shadow roots in DOM output modes. The high advisory concerns `IN_PLACE` hooks detaching a parent or sibling while event handlers remain armed.

## Remediation

- Root: add exact `overrides.dompurify: "3.4.17"`; keep every other dependency declaration unchanged.
- Root lockfile: 837 entries before and after. Only DOMPurify's `version`, `resolved`, and `integrity` change.
- Regenerate in Docker through the repository's `install` entry point. npm 11.19.1's plain install left 3.4.16 invalid against the override; a temporary supplemental Makefile runs targeted `npm update dompurify --package-lock-only --ignore-scripts` before `npm install`.
- Focus: change the existing exact direct dependency to 3.4.17 and run its containerized `deps` target. Lockfile: 207 entries before and after; only that declaration and DOMPurify's three resolution fields change.
- Focus renderer: replace the prebundled runtime with an in-memory Vite library build of `mermaid.core.mjs`, whose imports resolve to installed DOMPurify 3.4.17. Require DOMPurify in the bundle's module inventory and retain the runtime/hash for artifact inspection. The existing strict rendering, completeness assertions, and network block remain intact.
- Structural JSON comparisons remove only those permitted fields and require every remaining field to be identical. No unrelated package is added, removed, or updated.
- Project Makefiles, application code, test assertions, and generated tracked documentation remain unchanged.

## Verification

- Read-only `npm audit --json` on both trees no longer reports DOMPurify, either critical/high advisory, or low [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f). SHA-256 checks confirm manifests and lockfiles are unchanged by the scans.
- All non-DOMPurify vulnerability records are identical between baseline and post-fix audits.
- Installed root tree confirms `dompurify@3.4.17 overridden` beneath Mermaid. Runtime: Node 24.22.1, npm 11.19.1, containerized throughout.
- Root lint, workspace typecheck, API/UI builds, and `smoke-ui-bundle` pass with the fixed tree.
- The CI `test` target passes all seven workspaces: 7,006 tests passed, 260 skipped, 10 todo, no failures. API: 3,010 passed and 260 skipped; UI: 1,894 passed and 10 todo. Skips/todos are the suites' existing conditional/default selections, including provider acceptance; none was newly introduced or overridden.
- The UI's two `RapportView` tests pass; they cover report Markdown and controls, without a dedicated Mermaid-rendering assertion. Focus's five-diagram build supplies the actual Mermaid rendering check.
- Focus passes all 15 tests and its complete build: Vite 6.4.4, 1,536 UI modules, five complete Mermaid diagrams, standalone HTML, and a finalized 15-page PDF. Rendering assertions and timeouts are unchanged; generated tracked documents are restored byte-for-byte.
- Rebuilt Mermaid runtime contains DOMPurify 3.4.17 and no 3.4.12 version marker; its module inventory resolves `/node_modules/dompurify/dist/purify.es.mjs`. Runtime SHA-256: `1a935ae0b1e58df629cc4f60133ce9ec92fe84a16939ac61a77a3f0c07224788`.
- Evidence: `tmp/vite-focus-delivery/dompurify/evidence/`; temporary build/install adaptations: `tmp/vite-focus-delivery/support/dompurify*.mk`.

## Remaining findings

The root audit exits 1: 0 critical, 4 high, 2 moderate, 1 low package entries. Its four high entries represent two high advisories plus propagation, not four independent high advisories.

| Root package | Aggregate severity | Advisory or propagation |
| --- | --- | --- |
| `body-parser` | high | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| `zod` | high | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| `@ai-sdk/provider-utils` under `ollama-ai-provider` | high | Zod propagation; own low [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8) |
| `ollama-ai-provider` | high | Zod/provider-utils propagation |
| `fast-uri` | moderate | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr); low [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) |
| `ip-address` | moderate | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) |
| `@sentropic/graphify` | low | Ollama dependency-chain finding |

Focus exits 1 with 0 critical/high/moderate and 2 low package entries: `katex` ([GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)) and its dependent `mermaid`.

## Follow-ups

- The root security gate remains blocked by the listed high advisories under `rules/security.md`. Their remediation belongs to a separate dependency change; the owner's strict DOMPurify-only lockfile requirement excludes it here.
- No push, CI run, merge, or risk acceptance is claimed by this local delivery.
