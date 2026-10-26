# Select exactly one top-level resource from a kubectl kustomize render.
BEGIN { RS = "\n---\n"; found = 0 }
{
  count = split($0, lines, "\n"); kind = ""; name = ""; metadata = 0
  for (i = 1; i <= count; i++) {
    if (lines[i] ~ /^kind: /) kind = substr(lines[i], 7)
    if (lines[i] == "metadata:") metadata = 1
    else if (lines[i] ~ /^[^ ]/) metadata = 0
    if (metadata && lines[i] ~ /^  name: /) name = substr(lines[i], 9)
  }
  if (kind == target_kind && name == target_name) { print $0; found++ }
}
END { if (found != 1) { print "Expected exactly one resource" > "/dev/stderr"; exit 2 } }
