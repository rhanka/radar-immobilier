import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const path of ["ui/nginx/default.conf", "deploy/k8s/nginx/default.conf"]) {
  const config = readFileSync(path, "utf8");
  for (const route of ["/artifact-write/", "/api/v1/artifacts/write-intents/"]) {
    const escaped = route.replaceAll("/", "\\/");
    const location = config.match(new RegExp(`location ${escaped} \\{([^}]+)\\}`));
    assert.ok(location, `${path}: missing ${route}`);
    for (const header of ["Forwarded", "X-Forwarded-Host", "X-Forwarded-Proto"]) {
      assert.ok(location[1].includes(`proxy_set_header ${header} "";`),
        `${path} ${route}: remove ${header} inherited from clients or ingress`);
    }
  }
}
console.log("PASS PW-C proxy metadata removal");
