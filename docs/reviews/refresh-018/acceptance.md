# Graphify 0.18 preproduction acceptance — 2026-09-13

## Exact release

- Branch commit: `45659f33780ab0302e3008f379428419d6ff5c16`.
- Image: `ghcr.io/rhanka/radar-api@sha256:d4a46b5615a7510fd5bf3384f65dea8b881cb75ae3226a3dc3751a7f9271119e`.
- Package: `@sentropic/graphify@0.18.0`.
- Runtime route: enrolled Codex account through llm-mesh, provider `openai`, model `gpt-5.6-luna`, effort `high`; no per-token API key.

## Automated gates

- CI run `34786255021`: repo policy and quality gates PASS at the exact branch commit.
- Targeted adapter/regression suite: 42 PASS, 2 intentionally skipped.
- Production overlay offline render: `radar-refresh-scrape=false`, `radar-refresh-projection=false`, `radar-refresh-pv=true`; the new workload cannot be promoted by the legacy gate.

## Live preproduction evidence

The final image was applied through `refresh-018.mk apply-preprod`. The live state after acceptance is:

- `radar-refresh-pv`: active schedule `17 5 * * *`, immutable final image;
- legacy `radar-refresh-scrape` and `radar-refresh-projection`: suspended;
- encrypted keyring PVC and runtime/bootstrap Secrets: present.

Manual exact-image replay `radar-refresh-pv-r018-20260913-final3` completed from `22:19:02Z` to `22:19:36Z`.

The acceptance target temporarily moved the CronJob to the next minute, observed Kubernetes create owned Job `radar-refresh-pv-29822301`, immediately restored `17 5 * * *`, and waited for completion from `22:21:00Z` to `22:21:31Z`. Owner reference is `radar-refresh-pv`; this was a controller-created Job, not `kubectl create job`.

Both exact-image runs returned the same durable result:

- input hash: `07b8116bb635bb94f6ad7a049a90505cc8c12a64933d601d09262a7b68f6b553`;
- candidate hash: `sha256:3a87e943b12d0f1e4f4e6deb1eb925e560ef2ebfdb61472c41758a0f46c072b7`;
- state: `refresh/018/waterloo/runs/50da1274f04767fd70fc9ddedccdfb02d10cb24dac850215f28098d9de294853/state.json`;
- `modelCalls: 0`, proving the prior real Luna extraction resumes without duplicate charge or publication.

The preceding enrolled Luna execution made one real model call and published the grounded Waterloo typed Signal/PDF; these two final-image replays prove the immutable release consumes its canonical durable state.

## Promotion boundary

This receipt accepts preproduction and branch merge. Production remains deliberately dormant until its PVC/runtime credentials and OVH S3 binding are rendered, independently reviewed, and explicitly promoted after the storage transition. SCW TEM remains the sole allowed SCW exception until a replacement is validated.
