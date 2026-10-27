# @ai-sdk/provider-utils 2.x under ollama-ai-provider

- Status: resolved by security hotfix 3 on 2026-10-27.

## Resolution

Engram 0.21.2 replaces Graphify 0.18.0. The clean installed tree and generated
lockfile contain no Graphify, ollama-ai-provider or provider-utils 2.x.
The existing csv-parse 7.0.3 override follows the new Engram package name.
Both raw root audits report zero vulnerabilities. The three proposed Ollama
rows are deleted without adding an exception or suppressing scanner output.
See [the campaign finding](2026-10-27-dependency-security-hotfix-3.md).

## Historical investigation (2026-10-10)
- Severity: low (GitHub, CVSS 4.3)
- Advisory: GHSA-866g-f22w-33x8 / CVE-2026-8769 — patched `3.0.28`, `4.0.33`, `5.0.1`
- Owner: repository owner (to confirm)
- Review by: 2026-11-09 (UTC)
- Register rows: `EXC-2026-10-10-provider-utils-ollama`, `-ollama-ai-provider`, `-graphify-ollama`

## Affected (root `package-lock.json`)

- `@ai-sdk/provider-utils@2.2.8` — `node_modules/ollama-ai-provider/node_modules/@ai-sdk/provider-utils`
- `ollama-ai-provider@1.2.0` (inherited), `@sentropic/graphify@0.18.0` (inherited)

The 4.x copy used by `ai` / `@ai-sdk/*` is fixed in chore/deps-security-hotfix-2
(override `@ai-sdk/provider-utils@4.0.27` -> `4.0.33`).

## Reachability

Unbounded read of a provider HTTP response body. graphify imports
`ollama-ai-provider` only on its Ollama model branch; the API refresh path uses
llm-mesh runtime clients (`api/src/services/graph/refresh-mesh.ts`) and does not
select Ollama. Exploitation would need a controlled or compromised Ollama endpoint.

## Why not fixed here

`ollama-ai-provider@1.2.0` is the latest release (2025-01-17) and requires
`provider-utils ^2.0.0`; the only patched line is 3.x (different provider/Zod
contract). `@sentropic/graphify@0.19.1` drops it but is a breaking restructure
(re-exports `@sentropic/engram`, no `@sentropic/graphify/llm-mesh` subpath).

## Removal plan

Migrate graphify (0.19.x / engram) or replace the provider, regenerate the root
lockfile through Make, rescan, delete the register rows.
