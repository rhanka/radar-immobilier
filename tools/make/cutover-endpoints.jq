# Closed: no application Service has a ready or unready address. PostgreSQL
# Services (radar-postgres, radar-pg16, radar-pg18) stay served; the Endpoints
# object carries its Service labels, so they are recognised by label.
all(.items[]|select(.metadata.labels["app.kubernetes.io/component"]!="postgres");
  all(.subsets[]?; ((.addresses//[])|length)==0 and ((.notReadyAddresses//[])|length)==0))
