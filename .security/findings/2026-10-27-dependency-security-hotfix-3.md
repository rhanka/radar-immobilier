# Dependency security hotfix 3

- Status: dependency remediation and local application qualification complete.
- Base: `17f439c8d8e75303177ba8972a4fd7d8a8cbdc35`.
- Branch: `chore/deps-security-hotfix-3`.
- Scope: root npm workspaces and the independent architecture Focus npm tree.
- No push, merge or deployment. Independent review belongs to conductor Astra max.

## Raw dependency audits

| Tree | Before: critical/high/moderate/low | After | Raw exits before/after |
| --- | --- | --- | --- |
| Root, production-only | 0/3/2/1 | 0/0/0/0 | 1/0 |
| Root, complete | 0/3/2/1 | 0/0/0/0 | 1/0 |
| Focus, production-only | 0/0/0/2 | 0/0/0/0 | 1/0 |
| Focus, complete | 0/0/0/2 | 0/0/0/0 | 1/0 |

Counts are npm package entries, including propagation, not distinct advisories.
The baseline manifests and locks retain their original hashes. All eight
obsolete Zod/Ollama/Focus rows are deleted; no new acceptance is introduced.
The real HIGH/CRITICAL gate passes with zero covered or uncovered findings.

## Resolved versions

| Package or chain | Before | After |
| --- | --- | --- |
| fast-uri | 3.1.8 | 3.1.9 |
| ip-address | 10.7.3 | 10.7.5 |
| Focus KaTeX | 0.16.47 | 0.18.2; Mermaid remains 11.17.2 |
| Root KaTeX | 0.18.2 | 0.18.2 |
| Zod, five workspace consumers | 3.25.76 | ^4.6.6, one physical 4.6.7 copy |
| Graphify/Ollama/provider-utils 2.x | Graphify 0.18.0 | Engram 0.21.2; affected chain absent |
| TypeScript, seven compiler pins | 5.4.5 | 5.9.3 |
| csv-parse | 7.0.3 | 7.0.3, existing override retained under Engram |

Engram declares Zod ^4.6.6 and CSV ^6.2.1. Retaining CSV 7.0.3 avoids
reintroducing GHSA-8cw4-87c7-c6xx. The generated lock also resolves readdirp
5.0.0 to 5.1.1 within its existing range; the full version delta is recorded.
No publication blocker remains; mcp-auth stays on its existing 0.2.1.

## Application qualification and limits

- Clean installs and both npm ls trees pass, without invalid or affected copies.
- Production MCP parity: 12 wire definitions and 15 invalid-argument responses.
- Raw HTTP/stdio non-finite inputs are refused before effects; finite controls pass.
- Historical workspace/head GUIDs and lowercase normalization are preserved.
- Full CI application test recipe: 7,823 passed, 701 conditional skips, 10 todo.
- Initial failures and the scoped regressions are retained; no exclusions or timeouts changed.
- All-workspace typecheck (7 Svelte warnings), lint, API/UI builds and bundle smoke pass.
- All 67 security-gate tests pass. Focus trust controls and Mermaid bundle provenance pass.
- npm audit covers the two resolved dependency trees, not image OS layers or deployed artifacts.
- Focus provenance verifies installed KaTeX/DOMPurify; browser rendering is not claimed.
- Evidence: task worktree `tmp/hotfix3-evidence/`; final French report delivered separately.

## PR #932 review corrections

- Reviewed base: 59d4c1bfbffddbf46ed31e059e6c7395a225d426; both Astra reports were read in full.
- Explicit timestamp grammar preserves minute-only UTC and compact offsets without rewriting values or weakening calendar checks.
- Existing scrape-status shards, raw-document metadata and classification-card documentary dates remain readable.
- Listing URLs reject whitespace on the raw string; other accepted documentary URLs preserve their original value.
- Integer checks retain diagnostic accumulation, finite unsafe integers and historical HTTP pagination coercion.
- Infinity in a nonnumeric field retains invalid_type metadata; numeric D6 refusals remain enforced.
- Native registrar primitives match an actual Zod 3 registrar; non-finite characterization assertions are discriminating.
- 114 new regression tests compare against an isolated exact Zod 3.25.76 oracle; the bundled Zod 3 API mode also passes.
- Complete application suite: 7,823 passed, 701 conditional skips, 10 todo; typecheck, lint, builds, smoke and security gates pass.
- Both dependency trees remain unchanged and clean; no vulnerable oracle dependency is added to the workspace or delivered.
- Incremental bundle, command evidence and French review-correction report are delivered externally; no push.
