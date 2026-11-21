import type { MembershipQueryable } from "./admission.js";
import { PUBLISH_MAX_FILE_BYTES } from "./publish-policy.js";

/**
 * Page-text budget (HTML/CSS/JS/JSON, inline or staged): one ceiling applied
 * per file and per release text total. Everyone gets the 5 MiB default; an
 * admin may grant one actor an exception (migration 0049) never above the
 * hard system maximum below. Binary assets keep the release ceilings.
 */
export const PAGE_TEXT_DEFAULT_MAX_BYTES = PUBLISH_MAX_FILE_BYTES;
export const PAGE_TEXT_SYSTEM_MAX_BYTES = 10 * 1024 * 1024;

export interface PageTextBudget {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly source: "default" | "exception";
  readonly expiresAt: string | null;
}

export const DEFAULT_PAGE_TEXT_BUDGET: PageTextBudget = Object.freeze({
  maxFileBytes: PAGE_TEXT_DEFAULT_MAX_BYTES, maxTotalBytes: PAGE_TEXT_DEFAULT_MAX_BYTES,
  source: "default", expiresAt: null,
});

export type PageTextBudgetReader = (actorId: string) => Promise<PageTextBudget>;

/**
 * Effective budget of one actor: the active exception (unexpired, clamped to
 * the system maximum, never below the default) or the default. A read error
 * propagates so the caller fails closed instead of widening silently.
 */
export async function readPageTextBudget(db: MembershipQueryable, scope: string,
  actorId: string): Promise<PageTextBudget> {
  if (!actorId) return DEFAULT_PAGE_TEXT_BUDGET;
  const { rows } = await db.query(
    `SELECT max_bytes::text AS max_bytes, expires_at FROM artifacts.host_actor_page_text_exceptions
     WHERE storage_scope_id = $1 AND actor_id = $2 AND (expires_at IS NULL OR expires_at > now())`,
    [scope, actorId]);
  return pageTextBudgetFromRow(rows[0]);
}

/** Budget of one ACTIVE exception row (already filtered on expiry), or the default. */
export function pageTextBudgetFromRow(row: { readonly max_bytes?: unknown; readonly expires_at?: unknown } | undefined): PageTextBudget {
  if (!row) return DEFAULT_PAGE_TEXT_BUDGET;
  const granted = Number(row.max_bytes);
  if (!Number.isSafeInteger(granted) || granted <= PAGE_TEXT_DEFAULT_MAX_BYTES) return DEFAULT_PAGE_TEXT_BUDGET;
  const bytes = Math.min(granted, PAGE_TEXT_SYSTEM_MAX_BYTES);
  const expires = row.expires_at instanceof Date ? row.expires_at.toISOString()
    : typeof row.expires_at === "string" ? new Date(row.expires_at).toISOString() : null;
  return Object.freeze({ maxFileBytes: bytes, maxTotalBytes: bytes, source: "exception", expiresAt: expires });
}

export function pageTextBudgetReader(db: MembershipQueryable, scope: string): PageTextBudgetReader {
  return (actorId) => readPageTextBudget(db, scope, actorId);
}
