# Technical-store / runtime contract for A7 (ARTEFACTS A6/H5)

The H5 runtime configuration is incomplete. A durable ticket/session binding,
the A1 authority and the fixed API adapter are still required. The existing
ticket/activation/revocation maps are process-local module seams only.
These references alone cannot establish production integration:

- `ARTIFACTS_CONTENT_BASE` — bare hostname (existing resolver); unset keeps
  the capability closed.
- `ARTIFACTS_READER_GRANT_SECRET` — HMAC secret for the 55 s grants.
- `ARTIFACTS_READER_SESSION_SECRET` — AEAD secret for the page session.
- `ARTIFACTS_READER_ISSUER` / `ARTIFACTS_READER_AUDIENCE` /
  `ARTIFACTS_READER_TIER` — grant binding; synthetic defaults only for
  isolated tests, never production values.

Without an injected authority the content app refuses all page credentials;
without an operation port named API reads return `503`. Runtime smoke and
real-image browser acceptance remain blocked until integration is received.

## A7 ownership (opt-in overlay, not this packet)

- New `deploy/overlays/preprod/artifact-content-reader.yaml` and
  `artifact-content-reader-networkpolicy.yaml`, plus
  `deploy/overlays/preprod-h5/{kustomization,patch-artifact-content-ingress}.yaml`.
- Reader Deployment uses `args: ["content-reader"]`, never an entrypoint
  bypass; selectors stay distinct from `api`/`content-deny`.
- Network rules allow only the fixed API/Geo and technical-store paths,
  DNS and Traefik ingress, including receiving-side permissions.
- The denial Service keeps zero egress and no credentials.
- Default preprod stays on denial; recovery restores both Ingress backends
  to the existing denial Service, preserves TLS/hosts and data, and closes
  renewal/active streams within the retained 60 s cutoff.

## Image contract (applied by the integrator, verified by the H5 runner)

- `api/Dockerfile` bundles `api/dist/artifacts/content-reader-server.js`.
- `api/docker-entrypoint.sh` dispatches `content-reader`; `api`,
  independent `content-deny` and unknown-mode refusal preserved.
- `deploy/ci/check-image-entrypoints.sh` must list the new dist entrypoint
  (GH #812 guard); A7's render keeps the bundle referenced.
