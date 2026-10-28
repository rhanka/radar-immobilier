# Operator apply boundary; source/CD renders may retain mutable tags.
function judge( image, digest) {
  if (kind != "Deployment" || name !~ /^radar-(api|immo-mcp|artifact-content-deny)$/) return
  seen[name]++
  if (count("^[ \t]*(- )?image:") != 1 || count("^[ \t]*initContainers:"))
    fail("operator requires one pinned container per Deployment")
  image = field("^[ \t]*(- )?image:")
  digest = image; sub(/^.*@sha256:/, "", digest)
  if (image !~ /^ghcr\.io\/rhanka\/radar-api@sha256:/ || length(digest) != 64 || digest ~ /[^a-f0-9]/)
    fail("operator requires API/MCP/denial image digest pins")
  images[name] = image
}
END {
  if (seen["radar-api"] != 1 || seen["radar-immo-mcp"] != 1 || seen["radar-artifact-content-deny"] != 1)
    fail("operator requires exactly one API/MCP/denial Deployment")
  if (images["radar-api"] != images["radar-immo-mcp"] || images["radar-api"] != images["radar-artifact-content-deny"])
    fail("operator requires matching API/MCP/denial image digests")
  exit(fails > 0)
}
