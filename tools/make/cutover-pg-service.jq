# The radar-postgres Service exactly as 20-postgres-postgis.yaml declares it,
# retargeted to the namespace and to the one pod that serves (pg-switch).
(.items // [.])[] | select(.kind=="Service" and .metadata.name=="radar-postgres")
| {apiVersion, kind,
   metadata: {name: .metadata.name, namespace: $ns, labels: .metadata.labels},
   spec: (.spec | .selector["statefulset.kubernetes.io/pod-name"]=$pod)}
