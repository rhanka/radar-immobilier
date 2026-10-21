# NetworkPolicy and wildcard/TLS routing in canonical Kustomize output.
function judge( i, v, selector) {
  if (!n) return
  if (kind == "ConfigMap" && name == "radar-api") base = field("^  ARTIFACTS_CONTENT_BASE:")
  if (kind == "NetworkPolicy") {
    selector = "  podSelector:\n    matchLabels:\n      app.kubernetes.io/component: content-deny\n      app.kubernetes.io/name: radar-immobilier\n"
    if (name == "deny-content-deny-egress") {
      egress++
      if (!index(doc, selector) || !index(doc, "  policyTypes:\n  - Egress\n")) fail("exact deny-all egress selector/type required")
      if (count("^  egress:")) fail("egress stanza forbidden (deny-all)")
    } else if (name == "allow-traefik-to-content-deny") {
      ingress++
      if (!index(doc, selector) || !index(doc, "  policyTypes:\n  - Ingress\n")) fail("exact denial ingress selector/type required")
      if (count("^    - port: 3000$") != 1 || count("kubernetes.io/metadata.name: (traefik|kube-system)$") != 2) fail("Traefik ingress port/namespaces missing")
    } else if (count("^  egress:") && (!count("^      app.kubernetes.io/component:") || count("^      app.kubernetes.io/component: content-deny$"))) {
      fail("broad egress policy can select denial pods")
    }
  }
  if (kind == "Ingress" && name == "radar-artifact-content") {
    content++
    if (field("^  ingressClassName:") != "traefik") fail("Traefik ingress class required")
    if (count("^            name: radar-artifact-content-deny$") != 2 || count("^            name:") != 2) fail("content routes only to the denial Service")
    if (count("^  - host:") != 2 || count("^    - [\047\"]?\\*\\.") != 2) fail("both wildcard levels must be present")
    for (i = 1; i <= n; i++) {
      if (buf[i] ~ /^  - host:/) hosts[++hostCount] = val(buf[i])
      if (buf[i] ~ /^    - /) { v = buf[i]; sub(/^    - /, "", v); tlsHosts[++tlsCount] = unquote(v) }
    }
    tlsSecret = field("^    secretName:")
  }
}
END {
  if (egress != 1) fail("deny-content-deny-egress not found exactly once")
  if (ingress != 1 || content != 1) fail("expected exactly one denial ingress policy and content Ingress")
  if (phase == "disabled") {
    base = "artifacts-content-unverified.invalid"
    if (tlsSecret != "radar-artifact-content-unverified-tls") fail("unexpected disabled TLS placeholder")
  } else {
    if (base == "" || base ~ /(^|\.)(invalid)$/ || base ~ /unverified|replace-me/) fail("unfilled content-domain placeholder at activation")
    if (tlsSecret == "" || tlsSecret ~ /unverified|replace-me/) fail("unfilled content TLS Secret at activation")
  }
  if (hosts[1] != "*." base || hosts[2] != "*.pinned." base || tlsHosts[1] != hosts[1] || tlsHosts[2] != hosts[2]) fail("content domain/TLS wildcard mismatch or empty domain")
  exit(fails > 0)
}
