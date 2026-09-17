---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: 661b8571
lens: durable state/restart, budget, real-model trace, timeout/quality boundaries, and preprod-to-production deployment safety of public committed code
---

# Deployment review — corrected public-code leg

This is an independent, bounded review of the public committed diff
[`origin/main...661b8571`](https://github.com/rhanka/radar-immobilier/compare/main...661b8571).
It does not rely on the earlier Gemini leg, which failed before producing a
review because its gateway returned HTTP 503. No secrets, environment files,
keyrings, temporary material, unpublished work, running stacks, or tests were
read or used.

## Findings

### P1 — quota circuit state is lost across a restart

The documented policy is to bypass Astra for later documents after three
consecutive document-level quota fallbacks. However, restart recovery restores
only a per-document fallback reason and marks the restored document as counted;
it never reconstructs `consecutiveQuotaDocuments` or `circuitOpen` from the
durable receipts. Both counters are initialized to zero whenever the policy is
created. A Job that records three consecutive quota fallbacks and is then killed
(or reaches its deadline) will therefore resume with the circuit closed and can
call Astra again for the next document, contrary to the intended quota/budget
circuit behavior.

* Evidence: [`restoreDocument` only restores `reason`/`counted`, while the
  counters are local zero-valued variables](https://github.com/rhanka/radar-immobilier/blob/661b8571/api/src/services/graph/refresh-model-policy.ts#L49-L74).
* Evidence: restart recovery invokes that incomplete restoration for the durable
  receipt map before processing remaining chunks
  ([`refresh-run.ts`](https://github.com/rhanka/radar-immobilier/blob/661b8571/api/src/services/graph/refresh-run.ts#L198-L224)).
* Impact: a restart defeats the documented circuit in exactly the failure mode
  (quota exhaustion) it is intended to contain; it can cause unwanted primary
  calls and makes the durable policy outcome depend on Job lifetime.
* Required correction: persist or deterministically reconstruct the ordered
  document-level quota streak and open-circuit state from durable state before
  selecting the next document; add a restart-after-third-quota regression test.

### P1 — production activation is not mechanically gated on accepted preproduction evidence

Once the repository variable `REFRESH_CRONJOB_PROD_ENABLED` is `true`, every
`v*` production promotion deploys and unsuspends the production refresh CronJob.
The workflow condition does not require a recorded successful preproduction
primary run, forced-fallback run, or an owner-approved release-specific
attestation. The acceptance document describes those as manual prerequisites,
but a later tag can still activate the workload if the broad variable remains
armed. This leaves preprod-to-prod safety dependent on operator memory rather
than a release-bound deployment control.

* Evidence: the production workflow gates the deployment solely on
  `vars.REFRESH_CRONJOB_PROD_ENABLED == 'true'` and applies the production
  overlay ([workflow](https://github.com/rhanka/radar-immobilier/blob/661b8571/.github/workflows/build-push-images.yml#L1403-L1420)).
* Evidence: the production overlay changes `radar-refresh-pv` from the dormant
  base to `suspend: false`
  ([overlay](https://github.com/rhanka/radar-immobilier/blob/661b8571/deploy/k8s/refresh-cronjobs-prod/kustomization.yaml#L17-L25)).
* Impact: an unrelated subsequent release can begin scheduled real-model calls
  in production without demonstrating the specified preproduction acceptance
  for that exact release digest.
* Required correction: make production CronJob deployment depend on a
  release/digest-bound, protected promotion approval or attestation that records
  both required preproduction acceptance legs; make the enablement one-shot or
  automatically disarm it after deployment.

## Confirmed controls

The reviewed code does preserve completed chunks and records model receipts in
durable state; it reserves two calls per policy-controlled chunk, matching the
primary-plus-fallback maximum. The policy races each provider operation against
an abort deadline, rejects late or mismatched returned identities, owns the
output file rather than passing it to a provider client, and does not use a
quality/profile/provenance refusal as a fallback condition. The deployment base
is dormant, production activation uses a separate overlay, and the workflow
pins the CronJob image to the selected API digest rather than the base `:latest`
tag. These controls do not resolve the two findings above.

## Verdict

**NOT READY for production activation.** Resolve both P1 findings and review
the resulting public committed diff before setting the production refresh gate.
