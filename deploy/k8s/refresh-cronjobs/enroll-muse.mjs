/* global console, process */

import { createHash } from "node:crypto";

import { createLlmMeshFacade } from "@sentropic/llm-mesh-refresh/facade";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

// Enrols the owner's Muse seat (Meta device flow) into a fresh owner keyring,
// for a later `import-keyring-account IMPORT_TRANSPORT=muse`. A device-flow
// seat keeps its refresh grant in the keyring; a definitive refresh failure
// reads `reauth-required` and this enrolment is replayed.
const ownerScope = process.env.REFRESH_OWNER_SCOPE_REF;
if (!ownerScope) throw new Error("REFRESH_OWNER_SCOPE_REF is required");
const keyringDir = process.env.MUSE_KEYRING_DIR ?? "/keyring";

const facade = createLlmMeshFacade({
  mode: "cli",
  keyring: new EncryptedFileKeyring(keyringDir),
  configResolver: { async resolveConfig() { return {}; } },
});
const session = await facade.enroll("muse-code", {
  configRef: "default",
  mode: "cli",
  redirectUri: "https://accountscenter.meta.com/muse_code/",
  ownerScope,
});
if (session.kind !== "device-code") {
  throw new Error(`Unexpected Muse enrollment kind: ${session.kind}`);
}

// The consent URL and code go to the owner's terminal only, never to logs.
console.error(`Open this URL in the owner's browser: ${session.verificationUrl}`);
console.error(`Enter this one-time code: ${session.userCode}`);
const completed = await facade.completeMuseDeviceImport(session.enrollmentId, ownerScope);
const pseudonym = `acct-${createHash("sha256").update(completed.accountId).digest("hex").slice(0, 10)}`;
console.log(JSON.stringify({ status: "enrolled", account: pseudonym, transport: "muse" }));
