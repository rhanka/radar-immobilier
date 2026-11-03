# NetworkPolicy and wildcard/TLS routing in canonical Kustomize output.
function section(header, depth, i, inside, result) {
  for (i = 1; i <= n; i++) {
    if (buf[i] == header) { inside = 1; continue }
    if (inside && match(buf[i], /[^ ]/) <= depth + 1) break
    if (inside) result = result buf[i] "\n"
  }
  return result
}
function judge( i, v, labels, selector, podLabels) {
  if (!n) return
  labels = "      app.kubernetes.io/component: content-deny\n      app.kubernetes.io/name: radar-immobilier\n"
  selector = "    matchLabels:\n" labels
  if (kind == "ConfigMap" && name == "radar-api") base = field("^  ARTIFACTS_CONTENT_BASE:")
  if (kind == "Deployment" && name == "radar-artifact-content-deny") {
    denySeen++
    if (section("  selector:", 2) != selector) fail("exact denial deployment selector required (two labels, no more)")
    podLabels = "\n" section("      labels:", 6)
    if (!index(podLabels, "\n        app.kubernetes.io/component: content-deny\n") ||
        !index(podLabels, "\n        app.kubernetes.io/name: radar-immobilier\n"))
      fail("denial pod labels must carry the selector")
  }
  if (kind == "NetworkPolicy") {
    if (name == "deny-content-deny-egress" || name == "allow-traefik-to-content-deny") {
      if (section("  podSelector:", 2) != selector) fail("exact denial podSelector required (two labels, no more)")
    }
    if (name == "deny-content-deny-egress") {
      egress++
      if (!index(doc, "  policyTypes:\n  - Egress\n") || count("^  - (Ingress|Egress)$") != 1) fail("exact deny-all egress selector/type required")
      if (count("^  egress:")) fail("egress stanza forbidden (deny-all)")
    } else if (name == "allow-traefik-to-content-deny") {
      ingress++
      if (!index(doc, "  policyTypes:\n  - Ingress\n") || count("^  - (Ingress|Egress)$") != 1) fail("exact denial ingress selector/type required")
      if (count("^  - Egress$") || count("^  egress:")) fail("egress forbidden on denial ingress policy (NetworkPolicies are additive)")
      if (count("^    - port: 3000$") != 1 || count("kubernetes.io/metadata.name: (traefik|kube-system)$") != 2) fail("Traefik ingress port/namespaces missing")
    } else if (count("^  egress:") && (!count("^      app.kubernetes.io/component:") || count("^      app.kubernetes.io/component: content-deny$"))) {
      fail("broad egress policy can select denial pods")
    }
  }
  if (kind == "Ingress" && name == "radar-artifact-content") {
    content++
    if (field("^  ingressClassName:") != "traefik") fail("Traefik ingress class required")
    v = (phase == "general" ? "radar-api" : "radar-artifact-content-deny")
    # Transition: one content wildcard plus two retired immo-pages redirect
    # hosts. Removal ("Legacy redirect removal" in the runbook) returns every
    # count below to 1 and drops the legacy host assertions.
    if (count("^            name: " v "$") != 3 || count("^            name:") != 3) fail("content routes only to the " (phase == "general" ? "reader API" : "denial Service"))
    if (phase == "general" && count("^              name: http$") != 3) fail("content reader port must be http")
    if (count("^  - host:") != 3 || count("^    - [\047\"]?\\*\\.") != 3) fail("content wildcard plus both legacy redirect wildcards must be present")
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
  if (denySeen != 1) fail("expected exactly one denial Deployment")
  if (phase == "disabled") {
    base = "artifacts-content-unverified.invalid"
    if (tlsSecret != "radar-artifact-content-unverified-tls") fail("unexpected disabled TLS placeholder")
    if (hosts[1] != "*." base || hosts[2] != "*.legacy." base || hosts[3] != "*.pinned.legacy." base) fail("disabled content/TLS placeholder mismatch")
    if (tlsHosts[1] != hosts[1] || tlsHosts[2] != hosts[2] || tlsHosts[3] != hosts[3]) fail("disabled content/TLS placeholder mismatch")
    exit(fails > 0)
  } else {
    if (base == "" || base ~ /(^|\.)(invalid)$/ || base ~ /unverified|replace-me/) fail("unfilled content-domain placeholder in operator render")
    if (tlsSecret == "" || tlsSecret ~ /unverified|replace-me/) fail("unfilled content TLS Secret in operator render")
  }
  if (phase == "general" && tlsSecret != "radar-artifact-content-preprod-tls") fail("preprod content TLS Secret required")
  if (hosts[1] != "*." base) fail("content domain/TLS wildcard mismatch or empty domain")
  # Transition legacy redirect hosts: the real retired immo-pages wildcards in
  # general, the fixture `legacy.<base>` placeholders in every synthetic phase.
  # Removal ("Legacy redirect removal" in the runbook) drops hosts[2]/hosts[3]
  # and keeps exactly the one content wildcard.
  if (phase == "general") {
    if (hosts[2] != "*.preprod.immo-pages.sent-tech.ca" || hosts[3] != "*.pinned.preprod.immo-pages.sent-tech.ca") fail("content domain/TLS wildcard mismatch or empty domain")
  } else if (hosts[2] != ("*.legacy." base) || hosts[3] != ("*.pinned.legacy." base)) fail("content domain/TLS wildcard mismatch or empty domain")
  if (tlsHosts[1] != hosts[1] || tlsHosts[2] != hosts[2] || tlsHosts[3] != hosts[3]) fail("content domain/TLS wildcard mismatch or empty domain")
  exit(fails > 0)
}
