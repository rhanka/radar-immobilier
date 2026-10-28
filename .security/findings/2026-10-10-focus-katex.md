# KaTeX prototype-pollution gadget in docs/architecture/focus

- Status: resolved by security hotfix 3 on 2026-10-27.
- Severity: low (GitHub).
- Advisory: GHSA-238p-pmpm-9mq7 / CVE-2026-103923.
- Affected: KaTeX >=0.11.0 <0.18.2; patched: 0.18.2.

## Remediation

The independent Focus tree overrides katex to 0.18.2; the generated lockfile
replaces 0.16.47. Mermaid stays on 11.17.2. The root workspace already used
KaTeX 0.18.2 and keeps that version.

Both raw Focus audits, production-only and complete, exit 0 with no findings.
A clean Focus installation and npm ls --all pass. The advisory probe accepts
inherited trust under baseline 0.16.47 and refuses it under 0.18.2; explicit
trust and ordinary math remain positive controls.

The current render-mermaid.mjs builds mermaid.core.mjs from installed modules,
rather than loading Mermaid's precompiled standalone artifact. Repeating that
Vite bundle configuration confirms that the generated runtime includes the
installed katex/dist/katex.mjs (0.18.2) and dompurify/dist/purify.es.mjs.
The two proposed Focus register rows are therefore deleted without acceptance.

## Evidence and limits

- Raw audits: task worktree tmp/hotfix3-evidence/audit-{before,after}-focus-*.
- Trust probe: katex-probe.mjs and contract-probes.log in the same directory.
- Bundle provenance: focus-runtime.mjs, focus-runtime.log and focus-runtime.json.
- Browser rendering and deployed artifacts are not covered by this check.
- See [the campaign finding](2026-10-27-dependency-security-hotfix-3.md).
