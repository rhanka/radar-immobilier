import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { parseAllDocuments } from "yaml";

for (const environment of ["base", "preprod"]) {
  const docs = parseAllDocuments(readFileSync(`/evidence/manifests/${environment}.yaml`, "utf8"));
  assert(docs.every((doc) => doc.errors.length === 0), "invalid rendered YAML");
  const resources = docs.map((doc) => doc.toJS());
  const find = (kind, name) => {
    const matches = resources.filter((doc) => doc.kind === kind && doc.metadata.name === name);
    assert.equal(matches.length, 1, `${kind}/${name} must occur exactly once`);
    return matches[0];
  };
  assert(resources.every((doc) => doc.apiVersion && doc.kind));
  const receiver = find("ConfigMap", "radar-mcp-receiver").data;
  assert.equal(receiver.MCP_SIGNAL_SEARCH_ENABLED, "0");
  assert.equal(receiver.STRICT_RECEIVER_ARMED, "0");
  const api = find("Deployment", "radar-api").spec.template.spec.containers[0];
  for (const name of Object.keys(receiver)) {
    const binding = api.env.find((entry) => entry.name === name)?.valueFrom?.configMapKeyRef;
    assert.deepEqual(binding, { name: "radar-mcp-receiver", key: name, optional: true });
  }
  if (environment === "preprod") {
    assert(resources.every((doc) => !doc.metadata.namespace || doc.metadata.namespace === "radar-immobilier-preprod"));
    const mcp = find("Deployment", "radar-immo-mcp").spec.template.spec.containers[0];
    for (const [name, secret] of [["IMMO_MCP_ACCOUNT_DATABASE_URL", "immo-mcp-account-reader"],
      ["IMMO_MCP_WORKLOAD_CLIENT_SECRET", "immo-mcp-workload"]]) {
      assert.deepEqual(mcp.env.find((entry) => entry.name === name)?.valueFrom?.secretKeyRef,
        { name: secret, key: name });
    }
    // Role URLs follow the live database selected by the cutover (POSTGRES_DB).
    assert.deepEqual(mcp.env.find((entry) => entry.name === "IMMO_MCP_DATABASE_NAME")?.valueFrom?.secretKeyRef,
      { name: "radar-db-credentials", key: "POSTGRES_DB", optional: true });
    for (const suffix of ["SUB", "CLIENT_ID"]) {
      assert.deepEqual(mcp.env.find((entry) => entry.name === `IMMO_MCP_WORKLOAD_${suffix}`)?.valueFrom?.configMapKeyRef,
        { name: "radar-mcp-receiver", key: `STRICT_RECEIVER_WORKLOAD_${suffix}` });
    }
    const config = find("ConfigMap", "immo-mcp-config").data;
    assert.equal(config.IMMO_MCP_API_AUDIENCE, "https://preprod.immo.sent-tech.ca");
    assert.equal(config.IMMO_MCP_OAUTH_RESOURCE, `${config.IMMO_MCP_API_AUDIENCE}/mcp`);
    assert.equal(config.IMMO_MCP_OAUTH_ISSUER, "https://preprod.auth.sent-tech.ca");
    assert.equal(config.IMMO_MCP_EXCHANGE_TOKEN_ENDPOINT,
      "https://preprod.auth.sent-tech.ca/api/v1/auth/oauth/token");
    assert.equal(receiver.STRICT_RECEIVER_ENVIRONMENT, config.IMMO_MCP_EXCHANGE_ENV);
    assert.equal(config.IMMO_MCP_EXCHANGE_POLICY_REV, "a2base-search-v1");
  }
  const policy = find("NetworkPolicy", "allow-immo-mcp-to-postgres").spec;
  assert.equal(policy.ingress[0].from[0].podSelector.matchLabels["app.kubernetes.io/component"], "mcp");
  assert.deepEqual(policy.ingress[0].ports, [{ port: 5432, protocol: "TCP" }]);
  console.log(`${environment}: valid YAML, closed activation, named bindings, account network policy`);
}
