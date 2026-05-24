---
name: source-spike
description: Bootstrap a new source-feasibility spike in packages/radar-sources/src/sources/_spikes/
paths: "packages/radar-sources/src/sources/_spikes/**,docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md"
allowed-tools: Read Write Bash Glob Grep WebFetch
---

# Source Spike

Skill to investigate a new data source (avis publics, PV, vidéo YouTube, registre foncier, CPTAQ, etc.) and produce a feasibility note for the pricing pack.

## Steps

1. **Identify the source**
   - Kind: `avis-publics` | `pv` | `video-youtube` | `cadastre` | `role-evaluation` | `cptaq` | `donnees-quebec` | …
   - Reference city or jurisdiction: `salaberry-de-valleyfield` | `quebec` (provincial) | …
   - Slug (kebab-case): `<kind>-<city-or-scope>`.

2. **Create the spike directory**
   ```bash
   mkdir -p packages/radar-sources/src/sources/_spikes/<slug>/
   ```

3. **Fetch sample documents**
   Manually browse or `WebFetch` 3–5 representative documents. Save them under `packages/radar-sources/src/sources/_spikes/<slug>/samples/` (committed if small, otherwise referenced by URL only).

4. **Draft the spike README**
   Create `packages/radar-sources/src/sources/_spikes/<slug>/README.md` with:
   - **Source URL(s)** — entry points scraped.
   - **Format** — HTML / PDF / video / API JSON / SHP / etc.
   - **Access** — public free / public payant / API / login required.
   - **Sample inventory** — list of sample documents with URLs.
   - **Field inventory** — fields observed across samples, with frequency.
   - **Complexity** — easy / moderate / hard / unfeasible, with rationale.
   - **Automation level** — fully automatable / requires fallback / human-in-the-loop.
   - **Effort estimate** — man-days to build a production adapter.
   - **Recommendation** — build adapter now / wait / drop.
   - **Risks** — anti-bot, rate-limit, format change, legal.

5. **Update the consolidated feasibility spec**
   Append/refresh the row for this source in `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md` table.

6. **Commit**
   ```bash
   git add packages/radar-sources/src/sources/_spikes/<slug>/ docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md
   make commit MSG="feat(sources): spike <slug> feasibility note"
   ```

## Rules

- Spikes live in `_spikes/`. NEVER ship spike code outside this directory.
- The feasibility note is the deliverable; the code is exploratory.
- Effort estimates are honest: include the time to handle edge cases observed in the samples, not just the happy path.
- If a source needs paid access (JLR, Centris, registre foncier post-2026-04-01), document the licensing path and per-unit cost.
