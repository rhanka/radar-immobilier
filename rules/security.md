---
description: "Secrets, SAST, container scanning, vulnerability register"
paths: [".security/**", "**/Dockerfile*", "**/*.env*"]
tags: [security]
---

# Security

## Secrets

- Never commit `.env`, credentials, tokens, or private keys. `.gitignore` blocks the common cases; `git diff --cached` is checked by the `pre-commit` hook (BR-00 may stub it).
- Production secrets live in K8s `Secret` resources (Scaleway tenant), populated out-of-band.
- LLM API keys, Scaleway IAM keys, DB credentials: separate `Secret` per concern.
- For dev: `.env.example` documents the required keys; `.env` is per-developer and never tracked.

## Sandboxing

- Obscura runs as a separate Deployment (or container in compose). It only has egress to the configured source domains.
- The API container only has egress to: LLM providers, Obscura sidecar, Postgres, S3 endpoint, maildev. NetworkPolicy in K8s enforces this.
- No Obscura process on the host directly.

## SAST / SCA

- `npm audit` runs in CI on every PR.
- `make security-scan` runs Trivy on container images (added in BR-04 alongside K8s deploy).
- Findings go in `.security/findings/YYYY-MM-DD-<short>.md`.

## Scraping & legal

- Respect `robots.txt` and stated terms of service unless explicitly authorized for the radar use case.
- Honest user-agent: `radar-immobilier/0.x (+contact@…)`.
- Never spoof identity to circumvent paywalls.
- Anti-detect in Obscura is for *reliability* against bad anti-bot stacks, not for *deception* of paid services.

## PII

- The radar handles municipal public data; PII exposure is low but not zero (owners' names in rôle d'évaluation).
- Owner names are stored, never displayed in raw lists without justification, never sent to external LLMs in the spike phase. Confirm with the user before BR-07 if any source exposes PII.

## Vulnerability register

- Open issues in `.security/findings/` with severity (`critical` / `high` / `medium` / `low`).
- Critical and high are PR-blocking until mitigated or risk-accepted with user sign-off.
