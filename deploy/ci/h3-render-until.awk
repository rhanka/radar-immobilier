# Extract one data value without eval or ambient shell variables.
function judge() {
  if (kind == "ConfigMap" && name == "radar-api") print field("^  ARTIFACTS_VALIDATION_UNTIL:")
}
