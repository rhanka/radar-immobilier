/**
 * 6H attachment input: operator-supplied batch shape and guard. References
 * arrive as arguments; nothing is hardcoded or inferred.
 */
import { ScopeError } from "./scope.js";

export interface AttachmentEntry {
  accountId: string;
  workspaceId: string;
}

export interface AttachmentInput {
  entries: AttachmentEntry[];
  actorAccountId: string;
  reason: string;
}

export interface AttachmentReceipt {
  attached: number;
  pendingAmbiguous: number;
  replayed: boolean;
  pending: Array<{ accountId: string; workspaceIds: string[] }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertAttachmentInput(input: AttachmentInput): void {
  if (input.entries.length === 0 || input.entries.length > 500) {
    throw new ScopeError(400, "invalid_attachment_command");
  }
  if (!UUID_PATTERN.test(input.actorAccountId)) throw new ScopeError(400, "invalid_attachment_command");
  if (input.reason.length === 0 || input.reason.length > 512) {
    throw new ScopeError(400, "invalid_attachment_command");
  }
  for (const entry of input.entries) {
    if (!UUID_PATTERN.test(entry.accountId) || !UUID_PATTERN.test(entry.workspaceId)) {
      throw new ScopeError(400, "invalid_attachment_command");
    }
  }
}
