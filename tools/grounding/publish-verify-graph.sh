#!/usr/bin/env bash
# publish-verify-graph.sh — hash-verified graph publish (DETERMINISTIC, NO LLM).
#
# Pulls a staged graph JSON from a READ source, verifies its SHA-256, then publishes it to the
# DST graph store with a non-destructive backup + a re-read integrity check. Refuses any
# transfer whose hash does not match end-to-end (fail-closed). The pod NEVER runs an LLM/mesh:
# grounding happens on the host (publish-only model, plan 4.4.3) which stages the candidate here.
#
# Bucket-agnostic (SRC_*/DST_* env). Two uses:
#   - publish-only grounding (#588): SRC candidats/<city>/latest.json (host-staged grounded
#     candidate + .sha256 sidecar) -> DST graph/<city>/latest.json.  Set REQUIRE_SIDECAR=1.
#   - D4 seed: SRC graph/<city>/latest.json (canonical baseline) -> DST graph/<city>/latest.json.
#
# Usage: publish-verify-graph.sh <city> [src_prefix=candidats] [run_dir=/tmp/publish-verify]
# Env (required): SRC_S3_ENDPOINT SRC_S3_BUCKET SRC_AWS_ACCESS_KEY_ID SRC_AWS_SECRET_ACCESS_KEY
#                 DST_S3_ENDPOINT DST_S3_BUCKET DST_AWS_ACCESS_KEY_ID DST_AWS_SECRET_ACCESS_KEY
# Env (optional): AWS_REGION (default us-east-1) ; REQUIRE_SIDECAR=1 (fail if no .sha256 sidecar)
#   DST_PREFIX (default graph) — DST key prefix. 1-store migration: preprod publishes to `graph-preprod`
#     within the SAME docs-pocs bucket (isolation by PREFIX, the safety boundary). PERMIT-LIST fail-closed
#     (graph|graph-preprod|parsed) — never raw/ (READ-only source PVs) nor any other prefix.
set -euo pipefail
CITY="${1:?city requis}"
SRC_PREFIX="${2:-candidats}"
RUN="${3:-/tmp/publish-verify}"
DST_PREFIX="${DST_PREFIX:-graph}"

for v in SRC_S3_ENDPOINT SRC_S3_BUCKET SRC_AWS_ACCESS_KEY_ID SRC_AWS_SECRET_ACCESS_KEY \
         DST_S3_ENDPOINT DST_S3_BUCKET DST_AWS_ACCESS_KEY_ID DST_AWS_SECRET_ACCESS_KEY; do
  [ -z "${!v:-}" ] && { echo "publish-verify: FAIL-CLOSED — $v vide." >&2; exit 2; }
done
export AWS_REGION="${AWS_REGION:-us-east-1}"

# prefix-safety = THE safety boundary (1-store: preprod-grounded coexists with baseline `graph/` + source
# `raw/` in the SAME bucket, isolated only by prefix). PERMIT-LIST fail-closed — DST_PREFIX must be one of
# graph|graph-preprod|parsed ; anything else (raw/, empty, typo) is REFUSED (not a denylist "all but raw/",
# whose fail-open default would be the hole — recette gate).
case "$DST_PREFIX" in
  graph|graph-preprod|parsed) : ;;
  *) echo "publish-verify: FAIL-CLOSED — DST_PREFIX hors permit-list (graph|graph-preprod|parsed) : '$DST_PREFIX'" >&2; exit 2 ;;
esac
DST_KEY="$DST_PREFIX/$CITY/latest.json"
# belt-and-suspenders : la clé construite DOIT commencer par un préfixe permis (jamais raw/).
case "$DST_KEY" in
  graph/*|graph-preprod/*|parsed/*) : ;;
  *) echo "publish-verify: FAIL-CLOSED — DST_KEY hors permit-list : $DST_KEY" >&2; exit 2 ;;
esac

mkdir -p "$RUN/logs"
LOG="$RUN/logs/publish-$CITY.log"; : > "$LOG"
CAND="$RUN/$CITY.candidate.json"

src(){ AWS_ACCESS_KEY_ID="$SRC_AWS_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SRC_AWS_SECRET_ACCESS_KEY" s5cmd --endpoint-url "$SRC_S3_ENDPOINT" "$@"; }
dst(){ AWS_ACCESS_KEY_ID="$DST_AWS_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$DST_AWS_SECRET_ACCESS_KEY" s5cmd --endpoint-url "$DST_S3_ENDPOINT" "$@"; }
sha(){ sha256sum "$1" | awk '{print $1}'; }

src_obj="s3://$SRC_S3_BUCKET/$SRC_PREFIX/$CITY/latest.json"
dst_obj="s3://$DST_S3_BUCKET/$DST_KEY"
# SRC != DST : refuse le SELF-OVERWRITE (même endpoint + MÊME objet lu==écrit). 1-store : même bucket +
# préfixe DIFFÉRENT (candidats/ -> graph-preprod/) = LÉGITIME ; seul l'objet identique est refusé (≠ l'ancien
# garde bucket-égalité, qui bloquait à tort le publish intra-docs-pocs du modèle 1-store).
if [ "$SRC_S3_ENDPOINT|$src_obj" = "$DST_S3_ENDPOINT|$dst_obj" ]; then
  echo "publish-verify: FAIL-CLOSED — SRC==DST self-overwrite ($dst_obj) refusé." >&2; exit 2
fi

# 1. Pull le candidat depuis SRC.
if ! src cp "$src_obj" "$CAND" >>"$LOG" 2>&1 || [ ! -s "$CAND" ]; then
  echo "publish-verify[$CITY]: BLOCKED candidate_missing ($src_obj)" >&2; exit 1
fi
local_sha="$(sha "$CAND")"

# 2. Vérifie contre le sidecar .sha256 (host-staged) si présent ; REQUIRE_SIDECAR=1 => obligatoire.
if src cp "${src_obj}.sha256" "$CAND.sha256" >>"$LOG" 2>&1; then
  expected="$(awk '{print $1}' "$CAND.sha256")"
  [ "$local_sha" = "$expected" ] || { echo "publish-verify[$CITY]: FAIL-CLOSED — SHA candidat != sidecar ($local_sha != $expected)" >&2; exit 2; }
  echo "[publish-verify $CITY] sidecar SHA OK ($local_sha)" | tee -a "$LOG"
elif [ "${REQUIRE_SIDECAR:-}" = "1" ]; then
  echo "publish-verify[$CITY]: FAIL-CLOSED — sidecar .sha256 absent (REQUIRE_SIDECAR=1)" >&2; exit 2
else
  echo "[publish-verify $CITY] pas de sidecar (mode seed) — SHA source calculée $local_sha" | tee -a "$LOG"
fi

# 3. Résumable + backup : lire l'objet DST existant.
backup="(aucun: dst absent)"
if dst cp "$dst_obj" "$CAND.dst" >>"$LOG" 2>&1 && [ -s "$CAND.dst" ]; then
  if [ "$(sha "$CAND.dst")" = "$local_sha" ]; then
    echo "[publish-verify $CITY] SKIP déjà publié (SHA identique $local_sha)" | tee -a "$LOG"
    jq -cn --arg c "$CITY" --arg sha "$local_sha" '{city:$c,status:"skip_same_sha",sha:$sha}' >> "$RUN/manifest.jsonl"
    exit 0
  fi
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dst cp "$dst_obj" "s3://$DST_S3_BUCKET/$DST_PREFIX/$CITY/history/pre-publish-${ts}.json" >>"$LOG" 2>&1 \
    || { echo "publish-verify[$CITY]: FAIL-CLOSED — backup DST échoué, overwrite annulé" >&2; exit 1; }
  backup="$DST_PREFIX/$CITY/history/pre-publish-${ts}.json"
fi

# 4. Publish vers DST graph/ puis re-read -> vérifie SHA (intégrité transfert).
dst cp "$CAND" "$dst_obj" >>"$LOG" 2>&1
dst cp "$dst_obj" "$CAND.verify" >>"$LOG" 2>&1
[ "$(sha "$CAND.verify")" = "$local_sha" ] || { echo "publish-verify[$CITY]: FAIL-CLOSED — re-read DST SHA != source ($local_sha) — transfert corrompu (backup=$backup)" >&2; exit 2; }

bytes="$(wc -c < "$CAND")"
echo "[publish-verify $CITY] PUBLISHED $dst_obj (sha $local_sha, ${bytes}o, backup $backup)" | tee -a "$LOG"
jq -cn --arg c "$CITY" --arg src "$src_obj" --arg dst "$dst_obj" --arg sha "$local_sha" --argjson bytes "$bytes" --arg backup "$backup" \
  '{city:$c,status:"published",src:$src,dst:$dst,sha:$sha,bytes:$bytes,backup:$backup}' >> "$RUN/manifest.jsonl"
