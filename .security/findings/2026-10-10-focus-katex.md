# KaTeX prototype-pollution gadget in docs/architecture/focus

- Status: open — exception PROPOSED, UNSIGNED (accepted_by: null, accepted_on: null)
- Severity: low (GitHub)
- Advisory: GHSA-238p-pmpm-9mq7 / CVE-2026-103923 — katex `>=0.11.0 <0.18.2`, patched `0.18.2`
- Owner: repository owner (to confirm)
- Review by: 2026-11-09 (UTC)
- Register rows: `EXC-2026-10-10-focus-katex`, `EXC-2026-10-10-focus-mermaid`

## Affected (`docs/architecture/focus/package-lock.json`)

- `katex@0.16.47` — `node_modules/katex`
- `mermaid@11.17.2` — inherited (pins `katex ^0.16.47`)

The root workspace copy (chat-ui / svelte-streamdown / mermaid) is fixed in
chore/deps-security-hotfix-2 (override `katex` -> `0.18.2`).

## Reachability

Docs-only. Exploitation needs prior prototype pollution plus attacker-controlled
math. Focus renders local documents offline: `render-mermaid.mjs` loads the
precompiled `mermaid/dist/mermaid.min.js`, blocks HTTP/HTTPS, uses
`securityLevel: 'strict'` and rejects dangerous SVG elements/attributes.

## Why not fixed here

An override of the `katex` package would not change the KaTeX code embedded in
the precompiled `mermaid.min.js` (unverified), and 0.18 is outside Mermaid's
`^0.16.47` range (Mermaid 12.1.0 keeps the same range).

## Removal plan

Upgrade Mermaid once it ships patched KaTeX, regenerate the Focus lockfile
through `make -C docs/architecture/focus deps`, rebuild diagrams, rescan, delete
the register rows.
