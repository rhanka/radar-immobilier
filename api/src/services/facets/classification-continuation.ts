import { ClassificationError } from "./classification-errors.js";
import { cursorContext, parseClassificationCursor, signClassificationCursor, type CursorKeyring } from "./classification-cursor.js";

export interface SearchBinding { sub: string; workspaceId: string; citySlug: string; queryDigest: string; snapshotToken: string }
export function validateSignalContinuation(ring: CursorKeyring, binding: Omit<SearchBinding, "snapshotToken"> & { snapshotToken?: string }, limit: number, cursor: string | undefined, now: number) {
  const previous = cursor === undefined ? null : parseClassificationCursor(ring, cursor);
  if (previous) {
    const context = cursorContext(ring, binding.sub, binding.workspaceId, binding.citySlug, previous.keyId);
    if (previous.purpose !== "signal-search" || previous.contextDigest !== context
      || previous.queryDigest !== binding.queryDigest || previous.limit !== limit) throw new ClassificationError("incompatible_continuation");
    if (previous.issuedAt > now) throw new ClassificationError("invalid_cursor");
    if (previous.expiresAt <= now) throw new ClassificationError("cursor_expired");
    if (binding.snapshotToken !== undefined && previous.snapshotToken !== binding.snapshotToken) throw new ClassificationError("snapshot_changed");
  }
  return previous;
}
export function continueSignalSearch<T>(rows: readonly T[], ring: CursorKeyring, binding: SearchBinding, limit: number, cursor: string | undefined, now: number) {
  const previous = validateSignalContinuation(ring, binding, limit, cursor, now);
  if (previous && (previous.position === 0 || previous.position >= rows.length)) throw new ClassificationError("invalid_cursor");
  const position = previous?.position ?? 0;
  const remaining = rows.slice(position, position + limit + 1);
  const items = remaining.slice(0, limit);
  const nextCursor = remaining.length <= limit ? null : signClassificationCursor(ring, {
    v: 1, purpose: "signal-search", contextDigest: previous?.contextDigest
      ?? cursorContext(ring, binding.sub, binding.workspaceId, binding.citySlug),
    queryDigest: binding.queryDigest, snapshotToken: binding.snapshotToken, position: position + limit, limit,
    keyId: previous?.keyId ?? ring.currentKeyId, issuedAt: previous?.issuedAt ?? now, expiresAt: previous?.expiresAt ?? now + 300,
  });
  return { items, page: { limit, nextCursor, truncated: nextCursor !== null } };
}
