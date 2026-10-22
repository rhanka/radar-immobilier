# H3 configuration, credential isolation and image identity on rendered YAML.
function judge( i, key, v, expected, keys, image) {
  if (!n) return
  if ((kind != "Namespace" && namespace != "radar-immobilier-preprod") || (kind == "Namespace" && name != "radar-immobilier-preprod")) fail("namespace is not preprod")
  if (kind == "ConfigMap" && name == "radar-api") {
    cm++
    expected = (phase == "activation" ? "validation" : "off")
    if (phase != "rollback" && field("^  ARTIFACTS_CONTROL_MODE:") != expected) fail("expected " expected ": no activation by default")
    for (i = 1; i <= n; i++) if (buf[i] ~ /^  ARTIFACTS_/) {
      key = buf[i]; sub(/^  /, "", key); sub(/:.*/, "", key)
      v = val(buf[i]); config[key] = v
      if (phase == "disabled" && key != "ARTIFACTS_CONTROL_MODE") fail(key " must stay absent")
      if (phase == "rollback" && key != "ARTIFACTS_CONTENT_BASE") fail(key " must stay absent for H2 rollback")
      if (key ~ /ACCESS_KEY|SECRET_KEY/) fail("credential literal forbidden")
    }
    if (phase == "activation" || phase == "preparation") {
      split("STORAGE_SCOPE ORG_ID S3_BUCKET S3_ENDPOINT S3_REGION CONTENT_BASE VALIDATION_SUBJECTS VALIDATION_UNTIL", keys, " ")
      for (i in keys) if (config["ARTIFACTS_" keys[i]] == "") fail("empty or missing ARTIFACTS_" keys[i])
      if (config["ARTIFACTS_S3_ENDPOINT"] !~ /^https:\/\//) fail("activation storage endpoint must use HTTPS")
      if (config["ARTIFACTS_VALIDATION_UNTIL"] !~ /^[0-9-]+T[0-9:]+(\.[0-9]+)?Z$/) fail("expiration must be UTC ISO-8601")
    }
  }
  if (kind == "Deployment" && name == "radar-api") {
    api++; apiImage = field("^[ \t]*(- )?image:")
    for (i = 1; phase != "rollback" && i <= 2; i++) {
      key = (i == 1 ? "ARTIFACTS_S3_ACCESS_KEY" : "ARTIFACTS_S3_SECRET_KEY")
      expected = "        - name: " key "\n          valueFrom:\n            secretKeyRef:\n              key: " key "\n              name: radar-artifacts-preprod\n              optional: true\n"
      if (!index(doc, expected)) fail("exact optional Secret reference missing for " key)
    }
    if (count("^[ \t]*- name: ARTIFACTS_") != (phase == "rollback" ? 0 : 2)) fail("unexpected ARTIFACTS env override")
    if (phase == "rollback" && index(doc, "radar-artifacts-preprod")) fail("artifact Secret reference forbidden for H2 rollback")
  }
  if (kind == "Deployment" && name == "radar-artifact-content-deny") {
    deny++; denyImage = field("^[ \t]*(- )?image:")
    if (count("^[ \t]*command:")) fail("command bypasses entrypoint validation")
    if (!index(doc, "      - args:\n        - content-deny\n        image:")) fail("exact content-deny args missing")
    if (count("^[ \t]*(- )?image:") != 1 || count("^[ \t]*initContainers:")) fail("only one denial container allowed")
    if (field("^      automountServiceAccountToken:") != "false") fail("ServiceAccount token mount forbidden")
    if (count("^[ \t]*(env:|envFrom:|volumes:|volumeMounts:)|secretKeyRef|secretRef:|configMapRef:|configMapKeyRef"))
      fail("credential or volume mount forbidden")
    if (count("app.kubernetes.io/component: content-deny$") != 3 || count("app.kubernetes.io/component: api$")) fail("distinct denial selectors required")
  }
  if (kind == "Service" && name == "radar-artifact-content-deny") {
    svc++
    if (!index(doc, "  selector:\n    app.kubernetes.io/component: content-deny\n    app.kubernetes.io/name: radar-immobilier\n")) fail("exact denial Service selector required")
    if (field("^    port:") != "3000" || field("^    targetPort:") != "http") fail("denial Service port mismatch")
  }
  if (phase != "disabled" && ((kind == "Deployment" && name ~ /^radar-(api|ui|artifact-content-deny)$/) || kind ~ /^(Job|CronJob)$/)) {
    for (i = 1; i <= n; i++) if (buf[i] ~ /^[ \t]*(- )?image:/) {
      image = val(buf[i]); sub(/^.*@sha256:/, "", image)
      if (val(buf[i]) !~ /@sha256:/ || length(image) != 64 || image ~ /[^a-f0-9]/) fail("activation requires image digest pin")
    }
  }
}
END {
  if (cm != 1 || api != 1 || deny != 1 || svc != 1) fail("expected exactly one API ConfigMap/Deployment and denial Deployment/Service")
  if (apiImage == "" || (phase != "rollback" && denyImage != apiImage)) fail("denial image differs from api image")
  exit(fails > 0)
}
