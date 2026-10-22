# Read canonical kubectl kustomize YAML only. Buffer documents because data
# precedes kind/name. Manifest text is never evaluated as shell code.
function unquote(v, q) {
  sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
  q = substr(v, 1, 1)
  if ((q == "\"" || q == "\047") && substr(v, length(v), 1) == q)
    v = substr(v, 2, length(v) - 2)
  return v
}
function val(line) { sub(/^[^:]*:/, "", line); return unquote(line) }
function fail(msg) { print "FAIL: " kind "/" name ": " msg > "/dev/stderr"; fails++ }
function count(pattern, i, result) {
  result = 0
  for (i = 1; i <= n; i++) if (buf[i] ~ pattern) result++
  return result
}
function field(pattern, i) {
  for (i = 1; i <= n; i++) if (buf[i] ~ pattern) return val(buf[i])
  return ""
}
function reset() { n = 0; kind = ""; name = ""; namespace = ""; inmeta = 0; doc = "" }
BEGIN { reset() }
/^---[ \t]*$/ { judge(); reset(); next }
{
  buf[++n] = $0; doc = doc $0 "\n"
  if (/^kind:/) kind = val($0)
  if (/^metadata:/) { inmeta = 1; next }
  if (/^[^ \t]/) inmeta = 0
  if (inmeta && /^  name:/) name = val($0)
  if (inmeta && /^  namespace:/) namespace = val($0)
}
END { judge() }
