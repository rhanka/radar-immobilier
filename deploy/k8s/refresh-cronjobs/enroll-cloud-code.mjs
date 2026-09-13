import { createLlmMeshFacade } from "@sentropic/llm-mesh-refresh/facade";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

const ownerScope = process.env.CLOUD_CODE_OWNER_SCOPE_REF;
if (!ownerScope) throw new Error("CLOUD_CODE_OWNER_SCOPE_REF is required");

const facade = createLlmMeshFacade({
  mode: "cli",
  keyring: new EncryptedFileKeyring("/keyring"),
  configResolver: { async resolveConfig() { return {}; } },
});
const session = await facade.enroll("cloud-code", {
  configRef: "default",
  mode: "cli",
  redirectUri: "http://127.0.0.1:0/oauth/callback",
  ownerScope,
});
if (session.kind !== "authorization-url") {
  throw new Error(`Unexpected Cloud Code enrollment kind: ${session.kind}`);
}
console.log(JSON.stringify({
  status: "authorization-required",
  url: session.url,
  expiresAt: session.expiresAt,
}));
await facade.waitForCallback(session.enrollmentId);
console.log(JSON.stringify({ status: "enrolled", provider: "cloud-code" }));
