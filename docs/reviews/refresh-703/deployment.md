---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: d77f6132c4ce9cca30268adf507ee1061b86b2b7
lens: deployment safety and resource admission
---

# Deployment review

## Scope reviewed

Committed range `4e3a4db8f71fe4824bf9aa9f166d1d47b95211c4..d77f6132c4ce9cca30268adf507ee1061b86b2b7`, with focus on production admission, activation isolation, and immutable image selection.

## Findings

No blocking findings.

- **Info — production activation isolation:** `deploy/k8s/refresh-cronjobs-prod/kustomization.yaml` un-suspends only `radar-refresh-pv`; `radar-refresh-scrape` and `radar-refresh-projection` retain the base `suspend: true`. The overlay includes the keyring PVC required by PV refresh.
- **Info — quota admission:** `deploy/k8s/refresh-cronjobs-prod/kustomization.yaml` overrides the active PV container to a 256Mi request and 768Mi limit with a 512Mi Node heap. The init container is sequential and has lower resources, so the pod's effective quota limit remains 768Mi rather than the sum of init and application limits.
- **Info — runtime contract:** `deploy/k8s/34-refresh-cronjob.yaml` configures the PV job for Gemini Flash with `medium` reasoning effort and a `32768` output-token ceiling. `deploy/k8s/refresh-cronjobs/refresh-018.mk` render checks assert the production active-state, model, effort, token cap, 768Mi limit, and 512Mi heap.
- **Info — immutable release image:** `.github/workflows/build-push-images.yml` obtains `DIG_API` from the resolved/rebuilt manifest digest and passes it to `kustomize edit set image` as `ghcr.io/rhanka/radar-api@${DIG_API}`. The production overlay therefore replaces every base `:latest` reference, including the PV init container, with the same promoted immutable API digest.

## Verdict

**PASS — acceptable for PR review; do not merge or activate from this review.** The reviewed deployment changes satisfy the stated production constraints: only causal PV refresh is armed, its effective memory limit fits the 768Mi headroom, and the CD path pins the workload to the promoted digest rather than a mutable tag.
