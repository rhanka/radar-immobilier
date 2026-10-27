# General opening and its off rollback: shared configuration and opaque keys.
function reference(variable, secret, optional, expected) {
  expected = "        - name: " variable "\n          valueFrom:\n            secretKeyRef:\n              key: " variable "\n              name: " secret "\n"
  if (optional) expected = expected "              optional: true\n"
  if (!index(doc, expected) || count("^        - name: " variable "$") != 1)
    fail("exact Secret reference required for " variable)
}
function judge( i, key, value) {
  if (kind == "ConfigMap" && (name == "radar-api" || name == "immo-mcp-config")) {
    maps[name]++
    for (i = 1; i <= n; i++) if (buf[i] ~ /^  (ARTIFACTS_|CLASSIFICATION_CURSOR_)/) {
      key = buf[i]; sub(/^  /, "", key); sub(/:.*/, "", key)
      value = val(buf[i]); settings[name, key] = value
      if (key ~ /SECRET|ACCESS_KEY|DATABASE_URL/) fail("credential literal forbidden")
      if (key ~ /^ARTIFACTS_VALIDATION_/) fail("general opening has no cohort or window")
    }
  }
  if (kind == "Deployment" && name == "radar-api") {
    reference("ARTIFACTS_READER_GRANT_SECRET", "radar-artifacts-reader-preprod", 1)
    reference("ARTIFACTS_READER_SESSION_SECRET", "radar-artifacts-reader-preprod", 1)
    reference("CLASSIFICATION_CURSOR_SECRET", "radar-classification-cursor-preprod", 1)
    if (count("^        - name: CLASSIFICATION_CURSOR_") != 1) fail("cursor key ID must come from ConfigMap")
  }
  if (kind == "Deployment" && name == "radar-immo-mcp") {
    mcp++
    reference("IMMO_MCP_ARTIFACT_DATABASE_URL", "immo-mcp-artifact-writer", 0)
    reference("IMMO_MCP_ACCOUNT_DATABASE_URL", "immo-mcp-account-reader", 0)
    reference("ARTIFACTS_S3_ACCESS_KEY", "radar-artifacts-preprod", 1)
    reference("ARTIFACTS_S3_SECRET_KEY", "radar-artifacts-preprod", 1)
    if (count("^        - name: ARTIFACTS_") != 2) fail("unexpected MCP artifact override")
    if (count("configMapRef:") != 1 || count("secretRef:") || count("prefix:") ||
        !index(doc, "        envFrom:\n        - configMapRef:\n            name: immo-mcp-config\n")) fail("exact MCP envFrom required")
  }
}
END {
  if (maps["radar-api"] != 1 || maps["immo-mcp-config"] != 1 || mcp != 1) fail("API/MCP general composition missing")
  split("CONTROL_MODE STORAGE_SCOPE ORG_ID S3_BUCKET S3_ENDPOINT S3_REGION CONTENT_BASE", shared, " ")
  for (i in shared) {
    key = "ARTIFACTS_" shared[i]; value = settings["radar-api", key]
    if (value == "" || value != settings["immo-mcp-config", key]) fail("API/MCP mismatch or missing " key)
  }
  if (settings["radar-api", "ARTIFACTS_CONTROL_MODE"] !~ /^(general|off)$/) fail("expected matching general or off modes")
  if (settings["radar-api", "ARTIFACTS_STORAGE_SCOPE"] != "radar-immobilier-preprod" ||
      settings["radar-api", "ARTIFACTS_ORG_ID"] != "radar-immobilier-preprod") fail("preprod storage namespace required")
  if (settings["radar-api", "ARTIFACTS_S3_ENDPOINT"] != "https://s3.bhs.io.cloud.ovh.net" ||
      settings["radar-api", "ARTIFACTS_S3_BUCKET"] != "radar-immobilier-artifacts-preprod" ||
      settings["radar-api", "ARTIFACTS_S3_REGION"] != "bhs") fail("preprod artifact storage coordinates required")
  if (settings["radar-api", "ARTIFACTS_CONTENT_BASE"] != "preprod.immo-pages.sent-tech.ca") fail("preprod content base required")
  if (settings["radar-api", "ARTIFACTS_READER_ISSUER"] != "https://preprod.immo.sent-tech.ca" ||
      settings["radar-api", "ARTIFACTS_READER_AUDIENCE"] != "https://preprod.immo.sent-tech.ca/reader" ||
      settings["radar-api", "ARTIFACTS_READER_TIER"] != "preprod") fail("preprod reader approval identity required")
  if (settings["radar-api", "CLASSIFICATION_CURSOR_KEY_ID"] != "preprod-v1") fail("persistent cursor key ID required")
  exit(fails > 0)
}
