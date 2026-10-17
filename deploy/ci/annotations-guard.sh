#!/usr/bin/env bash
set -euo pipefail

refuse() { echo "::error title=Annotations adoption guard::$*" >&2; exit 1; }
operation="${1:-}"
case "$operation" in
  list) exit 0 ;;
  chain|restore) refuse 'Ordinary preprod restore is suspended: use a qualified closed conversion/retirement operation before reopening.' ;;
  rollback) refuse 'Image-only rollback is incompatible with annotation adoption; recover forward under the cutover authority.' ;;
  deploy) ;;
  *) refuse 'Unknown operation; no mutation authorized.' ;;
esac

: "${NAMESPACE:?NAMESPACE required}"
: "${GITHUB_SHA:?Exact release commit required}"
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || refuse 'Release identity must be a full commit SHA.'

# Owner-controlled operation receipt, not a new arming default or inferred authorization.
# Record only after module qualification, catalog/readback evidence, closed retirement
# and restore/backup dispositions. Missing or partial evidence refuses the release.
receipt="$(kubectl -n "$NAMESPACE" get configmap radar-annotations-cutover --ignore-not-found \
  -o 'jsonpath={.data.phase}{"|"}{.data.releaseCommit}{"|"}{.data.legacyRetired}{"|"}{.data.moduleQualified}{"|"}{.data.evidenceRef}')" \
  || refuse 'Cannot read the namespace operation receipt.'
IFS='|' read -r phase release_commit retired module_qualified evidence_ref <<< "$receipt"
[[ "$phase" == canonical && "$release_commit" == "$GITHUB_SHA" && "$retired" == true && \
   "$module_qualified" == true && -n "$evidence_ref" ]] \
  || refuse 'Canonical adoption and this exact release are not attested; stop before backup, migration or rollout.'
echo "[annotations] canonical operation receipt accepted for ${NAMESPACE}/${GITHUB_SHA} (${evidence_ref})"
