#!/usr/bin/env bash
# RBAC fail-fast: every right of the installed Role (deploy/cutover/rbac-<env>.yaml)
# is checked with `kubectl auth can-i` before any lock, inventory or mutation.
rbac_rights() {
  # One line per right: verb|resource|group|subresource|resource name (empty fields kept).
  awk -v OFS='|' '
    function list(line) { sub(/^[^[]*\[/, "", line); sub(/\][[:space:]]*$/, "", line); gsub(/[[:space:]]/, "", line); return line }
    /^---/ { kind = ""; next }
    /^kind:/ { kind = $2; rules = 0; next }
    kind != "Role" { next }
    /^rules:/ { rules = 1; next }
    !rules || /^[[:space:]]*(#|$)/ { next }
    /^  - apiGroups: \[/ { groups = list($0); resources = ""; names = ""; next }
    /^    resources: \[/ { resources = list($0); next }
    /^    resourceNames: \[/ { names = list($0); next }
    /^    verbs: \[/ {
      if (resources == "") { bad = 1; exit 2 }
      ng = split(groups, g, ","); nr = split(resources, r, ","); nv = split(list($0), v, ",")
      nn = split(names, n, ","); if (nn == 0) { nn = 1; n[1] = "" }
      if (ng == 0) { ng = 1; g[1] = "" }
      for (a = 1; a <= ng; a++) for (b = 1; b <= nr; b++) for (c = 1; c <= nv; c++) for (d = 1; d <= nn; d++) {
        res = r[b]; subr = ""
        if (index(res, "/")) { subr = substr(res, index(res, "/") + 1); res = substr(res, 1, index(res, "/") - 1) }
        grp = g[a]; gsub(/"/, "", grp)
        print v[c], res, grp, subr, n[d]
      }
      groups = ""; resources = ""; names = ""; count++; next
    }
    /^[a-z]/ { rules = 0; next }
    { bad = 1; exit 2 }
    END { if (bad || count == 0) exit 2 }
  ' "${1:-deploy/cutover/rbac-$ENV.yaml}"
}
rbac_preflight() {
  # rbac_preflight [adopt]: the permanent Role, plus the one-time adoption Role when asked.
  local verb resource group sub name label i=0 rights
  rights=$(rbac_rights) || fail "Unreadable RBAC manifest deploy/cutover/rbac-$ENV.yaml"
  if [[ ${1:-} == adopt ]]; then
    rights+=$'\n'$(rbac_rights "deploy/cutover/rbac-adopt-$ENV.yaml") || fail "Unreadable RBAC manifest deploy/cutover/rbac-adopt-$ENV.yaml"
  fi
  # A type the API server does not serve (CRD not installed, or a group x resource
  # pair that does not exist) has nothing to authorize: can-i would answer "no".
  # Partial discovery (an unavailable aggregated API) still lists the served core types.
  "${k[@]}" api-resources -o name > "$WORK/rbac-served" || [[ -s $WORK/rbac-served ]] || fail 'Cannot list served API resources'
  grep -qxF configmaps "$WORK/rbac-served" && grep -qxF jobs.batch "$WORK/rbac-served" || fail 'Served API resource discovery is incomplete'
  rm -f "$WORK"/rbac-missing.*
  while IFS='|' read -r verb resource group sub name; do
    grep -qxF "$resource${group:+.$group}" "$WORK/rbac-served" || continue
    i=$((i+1))
    label="$verb $resource${group:+.$group}${sub:+/$sub}${name:+ $name}"
    (
      args=(auth can-i "$verb" "$resource${group:+.$group}${name:+/$name}" --quiet)
      [[ -z $sub ]] || args+=("--subresource=$sub")
      "${k[@]}" "${args[@]}" >/dev/null 2>&1 || printf '%s\n' "$label" > "$WORK/rbac-missing.$i"
    ) &
    ((i % 8)) || wait
  done <<< "$rights"
  wait
  if compgen -G "$WORK/rbac-missing.*" >/dev/null; then
    fail "Missing RBAC rights in namespace $NS (install deploy/cutover/rbac-$ENV.yaml): $(cat "$WORK"/rbac-missing.* | sort | paste -sd ';' -)"
  fi
}
