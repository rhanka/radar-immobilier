/** PW-D public port: durable intent store wired to the PW-B admission hooks. */
export { PwWriteError } from "./pw-write-errors.js";
export { pwCanonicalJson, pwDigest, pwIntentDigest, newPwIntentIds } from "./pw-write-digests.js";
export type { PwPrincipal, PwIntentBinding } from "./pw-write-digests.js";
export { preparePwWriteIntentGuarded, preparePwWriteIntentInTx } from "./pw-write-prepare.js";
export { loadPwIntentForUpdate, loadPwIntentForShare, linkPwReceipt,
  readPwReceiptLink } from "./pw-write-store.js";
export { revokePwAuthority, revokePwIntent, readPwTombstone,
  pwIntentStatus } from "./pw-write-fences.js";
export type { PwAuthorityKind, PwIntentStatus } from "./pw-write-fences.js";
export { reservePwQuota, countPwPending } from "./pw-write-quotas.js";
export { appendPwAudit, appendPwRefusal } from "./pw-write-audit.js";
export { appendPwOutbox, listPwPendingOutbox, markPwOutboxDelivered,
  purgePwExpiredPayloads } from "./pw-write-outbox.js";
export { createDurableWriteAdmission, readPwWriteStatus } from "./pw-write-admission-durable.js";
export { confirmPwSignalWrite } from "./pw-write-confirm.js";
export type { PwConfirmation } from "./pw-write-confirmation.js";
