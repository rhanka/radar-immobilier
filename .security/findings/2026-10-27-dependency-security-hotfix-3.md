# Dependency security hotfix 3

- Status: remediation prepared; installation and qualification pending.
- Base: `17f439c8d8e75303177ba8972a4fd7d8a8cbdc35`.
- Branch: `chore/deps-security-hotfix-3`.
- Scope: root npm workspaces and the independent architecture Focus npm tree.
- No push, deployment or new vulnerability exception is authorized by this work.

## Baseline

Four raw containerized audits were captured against the unchanged base manifests
and lockfiles: `npm audit --omit=dev --json` and `npm audit --json`, each in the
root tree and `docs/architecture/focus`. All four exit with status 1.

| Tree | Critical | High | Moderate | Low | Package entries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Root, production-only | 0 | 3 | 2 | 1 | 6 |
| Root, complete | 0 | 3 | 2 | 1 | 6 |
| Focus, production-only | 0 | 0 | 0 | 2 | 2 |
| Focus, complete | 0 | 0 | 0 | 2 | 2 |

Counts are npm package entries, including propagated findings, rather than
distinct advisories or GitHub manifest-level alert counts. GitHub reports 13
open alerts: Zod in five workspace manifests and the lockfile, four fast-uri
advisories, ip-address, Focus KaTeX, and the Ollama provider-utils chain.

## Remediation targets

| Package or chain | Before | Target and treatment |
| --- | --- | --- |
| fast-uri | 3.1.8 | Compatible 3.1.9 patch |
| ip-address | 10.7.3 | Compatible 10.7.5 patch |
| Focus KaTeX | 0.16.47 | Override 0.18.2, the first patched release |
| Root KaTeX | 0.18.2 | Retain the already patched version |
| Zod | 3.25.76 | Migrate all five consumers to `^4.6.6` |
| Graphify/Ollama/provider-utils 2.x | Graphify 0.18.0 | Replace with published Engram 0.21.2 |
| TypeScript | 5.4.5 | Align seven compiler pins on 5.9.3 for Zod 4 |
| csv-parse | 7.0.3 under Graphify override | Retain the override under Engram |

Engram 0.21.2 declares Zod `^4.6.6`. Its CSV dependency `^6.2.1` would
reintroduce [GHSA-8cw4-87c7-c6xx](https://github.com/advisories/GHSA-8cw4-87c7-c6xx),
which affects csv-parse `<7.0.2`; the existing 7.0.3 override therefore follows
the new package name. This preserves the existing security fix.

KaTeX [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)
affects the independent Focus lockfile. The root override does not apply there.
Updating the Focus override avoids an unnecessary Mermaid major upgrade.

The current mcp-auth 0.2.1 already has no Zod dependency. It stays unchanged;
the current stateful MCP composition instead uses Zod 4's native JSON Schema
generator while retaining the published discovery contract.

## Coverage boundary and evidence

- Root `package-lock.json`: raw npm audit and the existing HIGH/CRITICAL CI gate.
- Focus lockfile: separate raw npm audits; it is outside the root workspace scan.
- Planned installed-tree checks reject vulnerable Zod copies and invalid peers.
- Image OS layers, deployed images and embedded/generated artifacts are not
  covered by these lockfile audits; no result for those surfaces is claimed.
- Raw audits, statuses, source hashes and reproduction scripts are retained under
  the task worktree's `tmp/hotfix3-evidence/`.
- The existing Zod acceptance remains in place until clean raw audit and physical
  tree evidence justify removing its exact rows. No new suppression is added.
