# Bascule iso-prod — RUN evidence capture ([a]–[g])

Codifies the timestamped artefacts i-infra certifies gate-by-gate, so the capture is
complete on the first RUN and replayable by CI/owner without AI (OPS-3). This is a
capture checklist, not a new action path: the RUN itself is `bascule.mjs` /
`.github/workflows/bascule-preprod.yml`. Every command here is a status/observation read.

## 0-PII-runner boundary (who captures what)

- **i-cond (runner-side)** captures only: kubeconfig SA identity, `kubectl get ... -o jsonpath={.status}`
  (never `kubectl logs`), `.spec.suspend`, deploy env presence, and the run-dir artefacts
  (`T1.txt`, `T1_EPOCH.txt`, `recon.ok.json`). No dump/doc bytes ever touch the runner.
- **i-infra (in-cluster)** certifies the data-plane gates that need in-cluster reads:
  VAP Deny message, SELECT-only DB grant, bucket ACL (PUT prod DENIED), ownerRef UID + GC,
  and Job container start (no `CreateContainerConfigError`).

## Fixed names (defaults from bascule.mjs @ 31a234ab)

| var | value |
| --- | --- |
| prod dump CronJob | `radar-db-backup-prod` (ns `radar-immobilier`) |
| preprod ns | `radar-immobilier-preprod` |
| dump bucket / prefix / suffix | `radar-immobilier-backups-preprod` / `postgres/prod/sets` / `.dump` |
| ephemeral docs secret | `radar-docs-src-preprod` (ownerRef=Job.UID, ttl 3600, preprod ns) |
| Jobs | freshness `radar-bascule-freshness` · restore `radar-db-restore-bascule` · rollback `radar-db-rollback-bascule` · migrate `radar-db-migrate-bascule` · docs-sync `docs-sync-prod-to-preprod` · recon `radar-bascule-recon` · runs `radar-bascule-runs-preprod` · refresh `radar-refresh-bascule` |
| kubeconfigs | prod `$DUMP_KUBECONFIG` (SA radar-ci-trigger-prod) · preprod (SA radar-ci-bascule-preprod) |

Set once: `PNS=radar-immobilier-preprod ; CJNS=radar-immobilier ; CJ=radar-db-backup-prod`.

## [a] token identity = radar-ci-trigger-prod (NOT radar-ci-dump-prod)

    date -u +%FT%TZ
    kubectl --kubeconfig "$DUMP_KUBECONFIG" auth whoami -o yaml   # expect SA radar-ci-trigger-prod

## [b] VAP prod negative + mint-after + suspend-only patch

    # @T1 — UPDATE test on jobTemplate/schedule → EXPECT Denied (radar-ci-trigger-suspend-only)
    date -u +%FT%TZ    # T1
    kubectl --kubeconfig "$DUMP_KUBECONFIG" -n "$CJNS" patch cronjob "$CJ" \
      --type=merge -p '{"spec":{"schedule":"7 7 * * *"}}'    # EXPECT: error, VAP Deny
    # token minted AFTER — record @T2 > T1 (2 timestamps prove order): owner/i-infra artefact
    # real patch = spec.suspend ONLY: diff before/after over the RUN
    kubectl -n "$CJNS" get cronjob "$CJ" -o yaml > /tmp/cj.before.yaml   # pre-RUN
    # ... bascule flips suspend=false then =true ...
    kubectl -n "$CJNS" get cronjob "$CJ" -o yaml > /tmp/cj.after.yaml
    diff /tmp/cj.before.yaml /tmp/cj.after.yaml   # EXPECT: only .spec.suspend differs

## [c] ephemeral secret radar-docs-src-preprod — ownerRef + GC (i-infra in-cluster)

    JUID=$(kubectl -n "$PNS" get job docs-sync-prod-to-preprod -o jsonpath='{.metadata.uid}')
    kubectl -n "$PNS" get secret radar-docs-src-preprod \
      -o jsonpath='{.metadata.ownerReferences[0].uid}'   # EXPECT: == $JUID
    # after Job terminal / ttlSecondsAfterFinished:3600
    kubectl -n "$PNS" get secret radar-docs-src-preprod   # EXPECT: NotFound (GC observed)

## [d] radar-db-ro-prod SELECT-only + immo-docs-prod PUT preprod OK / prod DENIED (i-infra)

- dump CronJob DB user: grant listing OR write attempt → denied (in-cluster).
- docs grant: PUT to docs-preprod OK, PUT to docs-prod DENIED (preprod-only, not bucket-owner-full-control).
- i-cond captures only the Job `.status` verdicts that consume these; the ACL/grant proof is i-infra's.

## [e] KUBE_CONFIG_DATA_BASCULE_PREPROD = radar-ci-bascule-preprod

    kubectl auth whoami -o yaml   # preprod kubeconfig → expect SA radar-ci-bascule-preprod

## [f] freshness GREEN + re-suspend after (always)

    cat <run-dir>/T1.txt <run-dir>/T1_EPOCH.txt          # T1 boundary persisted by S1
    kubectl -n "$PNS" get job radar-bascule-freshness -o jsonpath='{.status}'   # EXPECT: succeeded
    # fresh dump: key ⊇ EXPECTED_DATABASE, suffix .dump, Size>0, mtime>T1, in DUMP_BUCKET==RO-reader bucket
    kubectl --kubeconfig "$DUMP_KUBECONFIG" -n "$CJNS" get cronjob "$CJ" \
      -o jsonpath='{.spec.suspend}'                       # EXPECT: true (re-suspended)

Re-suspend is UNCONDITIONAL: freshness dispatch uses `failClosed:false` → returns `{ok}`,
then `kubectl patch ... suspend=true` runs (bascule.mjs:451), THEN `die` if `!verdict.ok`
(bascule.mjs:454). The re-suspend always precedes the die.

## [g] Jobs START (0 CreateContainerConfigError) + G4 recon 0-gap → flip

    for J in radar-db-restore-bascule radar-db-migrate-bascule radar-refresh-bascule \
             radar-db-rollback-bascule ; do
      echo "== $J =="; kubectl -n "$PNS" get job "$J" -o jsonpath='{.status}{"\n"}'
    done   # EXPECT: started, no CreateContainerConfigError (i-infra confirms container start)
    # secrets: restore/rollback → radar-pra-admin ; migrate/refresh(S6) → radar-docs-s3-credentials
    kubectl -n "$PNS" get job docs-sync-prod-to-preprod -o jsonpath='{.status}'   # ~2057 objects copied
    kubectl -n "$PNS" get job radar-bascule-recon -o jsonpath='{.status}'         # S3b 0-gap
    cat <run-dir>/recon.ok.json                                                   # sentinel, bucket match
    # G4 triple fail-closed: sentinel + assertReconOk + live recon re-run just before flip (bascule.mjs:924-925)
    # flip removes the drift literal:
    kubectl -n "$PNS" get deploy radar-api \
      -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\n"}{end}' \
      | grep -c GEO_DOCUMENTS_REPOINT   # EXPECT: 0 after flip
    # then S7 smoke preprod OK

## Order (matches i-infra gates)

VAP → RBAC T1 → test-prod DENIED → mint KUBE_CONFIG_DATA_PROD → CronJob suspend=false (trigger)
→ freshness → re-suspend=true → restore → migrate → docs-sync → recon (G4) → flip → refresh → smoke.
