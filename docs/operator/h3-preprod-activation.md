# H3 preprod activation and rollback — operator runbook

Technical rehearsal only (861c H3, design `conception-h3-v1.md` §11). There is
no standing activation: the committed overlay renders **disabled** (control
mode `off`, `.invalid` content placeholders), and every step below is an
explicit operator act with recorded digests. Never commit real values: secrets
and reviewed activation values are provisioned out-of-band; git holds opaque
references only.

## 0. Prerequisites (all unverified until the operator proves them)

| Prerequisite | Proof before GO |
| --- | --- |
| Provider quota/reservation capability | inspected library export + reservation/restart evidence |
| Real content base, DNS delegation, TLS/DNS-01 | reviewed base substituted locally, `check-h3-activation-render.sh` green |
| Private preprod bucket + scoped credentials | canary PUT/HEAD/GET/DELETE + cleanup receipt |
| Migration state, scope/org mapping | preflight output + migration receipt |
| Capacity for one extra denial pod | node allocatable vs denial requests |
| MCP regression results on the exact image | suite receipt with source SHA + image digest |
| CD target and enablement state | automatic deployment cannot bypass this gate |

This PR supplies disabled resources only. Provider quotas, migration needs and
commit-time authorization (unit 7) remain blocking prerequisites; no operational
GO follows from an offline render pass. Preflight does not prove storage,
migrations, DNS, certificate SANs or node capacity: attach separate receipts.

The disabled overlay retains inherited image tags as **unverified**. Before
activation, pin API, denial, UI and migration/job images by reviewed sha256
digests in the operator render. API and denial must use the same digest. The
gate checks canonical `kubectl kustomize` output, not arbitrary YAML styles.

Apply only these named objects in `radar-immobilier-preprod`: ConfigMap
`radar-api`, Deployment `radar-api`, the reviewed generated nginx ConfigMap and
`radar-ui` Deployment, Deployment/Service `radar-artifact-content-deny`,
NetworkPolicies `allow-traefik-to-content-deny` and `deny-content-deny-egress`,
and Ingress `radar-artifact-content`. The artifact and TLS Secrets are provisioned
out-of-band; the example Secret file is never applied wholesale. Record each
object hash, source SHA, image digest and operator receipt; never apply the full
overlay or broaden the CI deployer role.

CD reconciles the API ConfigMap/Deployment and nginx resources, but excludes the
new denial resources. The committed ConfigMap explicitly restores mode `off`
on reconciliation. Pause automatic preprod CD before the rehearsal and keep it
paused throughout the window, or first qualify a declarative activation render
that reconciliation actually consumes. An ad hoc live patch is insufficient.
Resume CD only after rollback to the reviewed disabled render; verify content
denial remains on its pinned image. CD state and this operator procedure remain
unverified against live infrastructure.

## 1. Activation order (design §11)

1. Provision reviewed resources and secrets without enabling control writes
   (`radar-artifacts-preprod` Secret, bucket, TLS Secret). Keep mode `off`.
2. Run any required migration once, using the reviewed image.
3. Deploy and verify the isolated denial boundary
   (`radar-artifact-content-deny` Deployment/Service + NetworkPolicies).
4. Apply and verify both wildcard routes and TLS coverage (operator apply of
   the reviewed Ingress; check both `*.BASE` and `*.pinned.BASE` deny).
5. Deploy the API/nginx changes with control mode `off`.
6. Verify baseline API/UI/MCP behavior.
7. After operational GO, enable the exact cohort and bounded window
   (`validation` + subjects + expiration, out-of-band, never committed).
8. Publish controlled fixtures, inspect receipts and persistence, and prove
   all content remains denied.
9. Close admission at completion or expiration; record retained objects and
   outstanding intentions.

Render gates for every step: `check-h3-preprod-render.sh` (committed state),
`check-h3-activation-render.sh` (activation render with reviewed values),
`preflight-h3-preprod.sh` (offline by default; live metadata probes require
`--live`, explicit `KUBECONFIG` and `H3_EXPECTED_API_IMAGE`; never applies).

## 2. Rollback

- Disable new admission and prevent unauthorized in-flight commits.
- Preserve artifact IDs, DB records, objects and accounting.
- Keep the denial service and content boundary active.
- Never unset `ARTIFACTS_CONTENT_BASE` while relying on H1 to protect hosts
  routed to the API.
- Rolling back to H2: remove the complete storage activation group (control
  mode, subjects, window, storage coordinates, Secret references) before
  restarting — H2 does not understand the new activation switch and could
  otherwise reopen control for all approved accounts.
- Keep the denial service on an image containing its entrypoint; do not roll
  it back blindly with the API.
- Do not delete storage or rewrite migration history.
- Recheck ordinary API/UI/MCP access and content denial after rollback.

## 3. Retained data

H3 has no automatic artifact GC. Before activation, qualify the provider's
bounded inventory and allocation cap (not delivered by this PR). Record
failed-write objects for accounting. Record
retained fixture objects and outstanding intents explicitly; never delete an
artifact prefix manually as a substitute for lifecycle handling. Automatic
purge, fork-safe collection and complete deletion receipts are not covered.

## 4. Credential cycle

`radar-artifacts-preprod` (shape in `deploy/k8s/secrets.example.yaml`) is
created out-of-band per activation window and removed on rollback. Rotation:
mint a new Secret revision, restart the api pods, verify admission, delete
the old revision. At any time an operator can verify recovery from the
documented references — no per-act owner step is encoded here.
