import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createPostgresReaderConsentStore } from "@sentropic/artifacts/adapters/postgres-reader-consent";
import { consentAllows, type ReaderConsentRecord } from "@sentropic/artifacts/server/consent";
import type { ArtifactReaderStore } from "@sentropic/artifacts/server/reader-store";

/**
 * Reader consent — durable BASKETS consent (reader-consent design, central
 * decision).
 *
 * The persisted consent is the baskets consent, never the opening screen:
 * - `baskets.read` covers the H5 business reads (`workspaces.list.v1`,
 *   `baskets.context.v1`, `baskets.search.v1`, `baskets.state.v1`);
 * - `baskets.write.prepare` covers write-intent preparation only and never
 *   executes a write: every write keeps its own in-app confirmation, which
 *   re-checks this scope at confirmation time.
 *
 * Gate B (design §2): every business call re-reads the store — a sealed
 * session claim is at most a routing hint, never authority — so revocation
 * is effective at the very next H5 call, even under a live cookie (design
 * §3.3). Document opening (Gate A) persists nothing: the neutral screen
 * shows on every opening, renewal stays silent on fresh rights alone.
 *
 * Consent rows never record data use: no basket identifier, no query, no
 * page data, no session/device/network data. Revocation keeps history:
 * re-grant after revoke mints a new row.
 */

/** Host-declared baskets scope ids: what the persisted consent covers. */
export const BASKET_READ_SCOPE_ID = "baskets.read";
export const BASKET_WRITE_PREPARE_SCOPE_ID = "baskets.write.prepare";
/** Scope version: widening the baskets contract bumps it and re-arms every screen. */
export const BASKET_SCOPE_VERSION = "v1";
/** The two scopes are granted and revoked independently. */
export const BASKET_CONSENT_SCOPES: readonly string[] = Object.freeze(
  [BASKET_READ_SCOPE_ID, BASKET_WRITE_PREPARE_SCOPE_ID]);

/**
 * H5 business read operation → consent scope. Document reads, files,
 * design-kit, tiles and the governed geo catalogue never need consent.
 */
export function consentScopeForReadOperation(op: string): string | null {
  switch (op) {
    case "workspaces.list.v1":
    case "baskets.context.v1":
    case "baskets.search.v1":
    case "baskets.state.v1":
      return BASKET_READ_SCOPE_ID;
    default:
      return null;
  }
}

/** Narrow Gate B contract: the H5 dispatch and the write paths check this per call. */
export interface BasketConsentGate {
  hasLiveConsent(readerAccountId: string, artifactId: string, scopeId: string): Promise<boolean>;
}

export interface ReaderConsentService extends BasketConsentGate {
  readonly store: ArtifactReaderStore;
  findLiveConsent(readerAccountId: string, artifactId: string,
    scopeId: string): Promise<ReaderConsentRecord | undefined>;
  /**
   * First-party gesture on the control-origin baskets screen; converges on
   * a live row per scope. A ledger failure never blocks the consented call;
   * the screen simply shows again next time.
   */
  grantScopes(readerAccountId: string, artifactId: string,
    scopeIds: readonly string[]): Promise<ReaderConsentRecord[]>;
}

export function readerConsentKey(storageScopeId: string, readerAccountId: string,
  artifactId: string, scopeId: string) {
  return { storageScopeId, readerAccountId, artifactId, scopeId, scopeVersion: BASKET_SCOPE_VERSION };
}

/** Live row at the current scope version authorizes Gate B (fresh rights verified by the caller). */
export function consentAllowsBaskets(record: ReaderConsentRecord | undefined): record is ReaderConsentRecord {
  return consentAllows(record, BASKET_SCOPE_VERSION);
}

/** Scopes the baskets screen grants: read always, write-prepare only when the page may prepare actions. */
export function basketsScopesForPage(permitsWrite: boolean): readonly string[] {
  return permitsWrite ? BASKET_CONSENT_SCOPES : [BASKET_READ_SCOPE_ID];
}

export function createReaderConsentService(pool: pg.Pool, storageScopeId: string,
  now: () => string = () => new Date().toISOString()): ReaderConsentService {
  const store = createPostgresReaderConsentStore(pool);
  const findLiveConsent = (readerAccountId: string, artifactId: string, scopeId: string) =>
    store.findLiveConsent(readerConsentKey(storageScopeId, readerAccountId, artifactId, scopeId));
  return {
    store,
    findLiveConsent,
    hasLiveConsent: async (readerAccountId, artifactId, scopeId) =>
      consentAllowsBaskets(await findLiveConsent(readerAccountId, artifactId, scopeId)),
    grantScopes: async (readerAccountId, artifactId, scopeIds) => {
      const granted: ReaderConsentRecord[] = [];
      for (const scopeId of scopeIds) {
        if (!BASKET_CONSENT_SCOPES.includes(scopeId)) continue;
        granted.push(await store.grantConsent({
          ...readerConsentKey(storageScopeId, readerAccountId, artifactId, scopeId),
          consentId: randomUUID(), grantedAt: now(), grantedVia: "reader_screen",
        }));
      }
      return granted;
    },
  };
}
