/* global console, process */

import { createHash } from "node:crypto";

import { createLlmMeshFacade } from "@sentropic/llm-mesh-refresh/facade";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

const ownerScope = process.env.REFRESH_OWNER_SCOPE_REF;
if (!ownerScope) throw new Error("REFRESH_OWNER_SCOPE_REF is required");

const facade = createLlmMeshFacade({
  mode: "cli",
  keyring: new EncryptedFileKeyring("/keyring"),
  configResolver: { async resolveConfig() { return {}; } },
});
const session = await facade.enroll("codex", {
  configRef: "default",
  mode: "cli",
  redirectUri: "https://auth.openai.com/deviceauth/callback",
  ownerScope,
});
if (session.kind !== "device-code") {
  throw new Error(`Unexpected Codex enrollment kind: ${session.kind}`);
}

// The consent URL and code are written only to the owner's terminal. They are
// deliberately not emitted as structured logs or retained in any receipt.
console.error(`Open this URL in the owner's browser: ${session.verificationUrl}`);
console.error(`Enter this one-time code: ${session.userCode}`);
const completed = await facade.pollForCompletion(session.enrollmentId);
const pseudonym = `acct-${createHash("sha256").update(completed.accountId).digest("hex").slice(0, 10)}`;
console.log(JSON.stringify({ status: "enrolled", account: pseudonym, transport: "codex" }));
