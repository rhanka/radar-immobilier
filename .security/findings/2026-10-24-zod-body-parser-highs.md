# Root Zod and body-parser high advisories

- Status: body-parser fixed at 2.4.0; Zod blocked by the owner's no-major/no-peer-break constraint
- Severity: high for both advisories
- Advisories: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)
- body-parser published: 2026-10-23; detected and compatible fix applied: 2026-10-24
- Affected: Zod `<4.6.6`; body-parser `<1.20.9` or `>=2.0.0 <2.4.0`
- Patched: Zod 4.6.6; body-parser 1.20.9 / 2.4.0
- Owner: repository owner

## Affected and exposure

The installed root tree has exactly two relevant instances: `node_modules/zod@3.25.76` and `node_modules/body-parser@2.3.0`. There is no body-parser 1.x instance. Installed manifests, `npm ls --all`, `npm explain`, and the lockfile agree. All Zod consumers share the root instance; no nested Zod copy was found.

| Zod consumer (installed path relative to root) | Version | Declared dependency / peer range |
| --- | --- | --- |
| `api` | 0.0.0 | dependency `^3.23.8` |
| `packages/radar-domain` | 0.0.0 | dependency `^3.23.8` |
| `packages/radar-scoring` | 0.0.0 | dependency `^3.23.8` |
| `packages/radar-sources` | 0.0.0 | dependency `^3.23.8` |
| `packages/immo-mcp` | 0.0.1 | dependency `^3.25.76` |
| `node_modules/ollama-ai-provider` | 1.2.0 | peer `^3.0.0` |
| `node_modules/ollama-ai-provider/node_modules/@ai-sdk/provider-utils` | 2.2.8 | peer `^3.23.8` |
| `node_modules/@ai-sdk/anthropic` | 3.0.81 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/@ai-sdk/cohere` | 3.0.36 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/@ai-sdk/gateway` | 3.0.125 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/@ai-sdk/google` | 3.0.80 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/@ai-sdk/mistral` | 3.0.37 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/@ai-sdk/openai` | 3.0.68 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/@ai-sdk/provider-utils` | 4.0.33 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/ai` | 6.0.197 | peer `^3.25.76 \|\| ^4.1.8` |
| `node_modules/@mistralai/mistralai` | 1.15.1 | dependency `^3.25.0 \|\| ^4.0.0` |
| `node_modules/@modelcontextprotocol/sdk` | 1.32.1 | dependency and peer `^3.25 \|\| ^4.0` |
| `node_modules/zod-to-json-schema` | 3.25.2 | peer `^3.25.28 \|\| ^4` |

- body-parser's sole immediate consumer is `node_modules/express@5.2.1`, dependency `^2.2.1`. Chain: `packages/immo-mcp` → `@modelcontextprotocol/sdk@1.32.1` → Express → body-parser.
- The API and MCP application HTTP entry points use Hono; `packages/immo-mcp/src/server-http.ts` imports the SDK's Web Standard transport. A deployed Express request path has not been demonstrated. The dependency-tree finding remains in scope regardless of that reachability limit.
- A standalone Express instance using the installed dependency reproduces the body-parser advisory: a valid gzip frame, a zero byte, and 100 KiB of trailing bytes cause an unhandled `Z_DATA_ERROR` and terminate Node with exit 1 under 2.3.0. This establishes package-level exploitability, not deployed application reachability.
- Zod can exhaust memory while validating oversized constrained collections. No production exploit or resource-exhaustion probe was performed. Functional boundary checks do not mitigate this advisory.

## Remediation

- Containerized, targeted `npm update body-parser --package-lock-only --ignore-scripts`, followed by the root Make `install` target in a source snapshot excluding all environment files.
- `body-parser`: 2.3.0 → 2.4.0, within Express's existing `^2.2.1`. No override or manifest change is needed.
- Required dependency `node_modules/body-parser/node_modules/iconv-lite`: 0.7.2 → 0.7.3, because body-parser now requires `^0.7.3`.
- Required dependency `node_modules/qs`: 6.16.0 → 6.16.1, because body-parser now requires `^6.16.1`. Express's existing range also accepts it.
- body-parser's content-type requirement changes from `^2.0.0` to `^2.1.0`; its existing nested 2.1.0 instance already satisfies this, so no content-type entry changes. All other transitive resolutions remain unchanged.
- Strict structural comparison: 837 lockfile entries before and after, identical path sets; only the three entries above change. All other package data, Zod, and the entire root manifest are byte/structurally unchanged. No major version is changed.

## Zod compatibility blocker and options

The audit marks every version below 4.6.6 affected, including installed 3.25.76. The registry provides 4.6.6, but no patched stable 3.x release. A global override to 4.x would both change the installed major and violate five workspace dependency ranges and both Ollama peer ranges. Adding another 4.x copy would leave the affected 3.x instance installed. Neither is a fix permitted by this campaign.

1. **Compatible upstream backport:** retain Zod 3 until a published 3.x security backport is available and the advisory recognizes it. Impact: no application migration, but the high finding remains blocking meanwhile. Acceptance: compatible installed tree and read-only audit showing the advisory removed.
2. **Separately authorized Zod 4 migration:** migrate the five workspace consumers and replace/remove the Ollama/provider-utils 2.x dependency chain through a compatible Graphify/provider migration. Impact: schema, error/default behavior, JSON-schema and provider contract changes requiring dedicated API/domain/MCP/provider validation. Updating Graphify alone cannot fix the five direct Zod 3 consumers. Acceptance: no installed affected Zod instance, no invalid peers, full gates and zero high/critical findings.

No major upgrade, peer override, risk acceptance, or security-register suppression was introduced. This is an explicit uncompleted security objective, not a successful zero-high remediation.

## Verification

- Read-only final `npm audit --json` exits 1: 0 critical, 3 high, 2 moderate, 1 low package entries. body-parser and GHSA-27r3-jxmh-p828 disappear; all other vulnerability records are identical. SHA-256 checks confirm that both audits leave the manifest and lockfile unchanged. The post-`npm ci` installed tree has body-parser 2.4.0 and Zod 3.25.76 with no invalid peers. Runtime: Node 24.22.1, npm 11.19.1.
- Root lint, all-workspace typecheck (0 errors, 7 Svelte warnings), API/UI builds and browser-bundle smoke pass. The final CI `test` target passes all seven workspaces: 7,006 passed, 260 skipped, 10 todo. API: 3,010 passed, 260 skipped; UI: 1,894 passed, 10 todo. Existing conditional selections are retained.
- The first full run exits 1 despite all 7,006 assertions passing: `artifacts-commit-probe.spec.ts` exceeds its 20-second `afterAll` timeout while cleaning S3/Postgres. The precise stalled operation is unknown. Its four tests and cleanup then pass in isolation in 4.88 seconds; the full unchanged command also passes on rerun. No timeout/assertion/exclusion is modified and no flaky acceptance is claimed; the initial failure remains in the evidence.
- The same 12 Express parsing checks reproduce one failure under 2.3.0 and pass under 2.4.0: JSON; gzip/deflate/Brotli; malformed JSON; body-size limit; unsupported encoding; nested forms; parameter limit; UTF-8 text; raw bytes; and the advisory payload followed by a successful health request.
- Fifteen checks against actual API/domain Zod schemas pass: strict object keys, UUIDs, discriminators, eight/nine deselections, 500/501 batch items, empty batches, mode, defaults, confidence, and evidence requirements. They validate behavior only; Zod remains vulnerable.
- Evidence and reproducible Make/Compose/probe sources: `tmp/deps-highs-delivery/evidence/`, `tmp/deps-highs-delivery/support/`, and `tmp/deps-highs-delivery/campaign.mk`.
- Coverage boundary: npm audit covers the resolved root npm tree. No new image-layer, vendored-code, Focus-tree, or production deployment scan is claimed. The existing tools image is reused; no image is delivered by this patch.

## Remaining findings

- Zod high [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), propagated through Ollama/provider-utils; the three high package entries represent one high advisory.
- provider-utils 2.x low [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8); Ollama/Graphify propagation. See the existing provider-utils finding; its proposed exception remains unsigned.
- fast-uri moderate [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr); low [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp).
- ip-address moderate [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5).
- All non-body-parser vulnerability records are identical before/after. The zero-high/critical condition is not met; Zod remains PR-blocking under `rules/security.md`. No push, remote CI result, merge, or deployment is claimed.
