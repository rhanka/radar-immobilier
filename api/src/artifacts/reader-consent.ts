import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createPostgresReaderConsentStore } from "@sentropic/artifacts/adapters/postgres-reader-consent";
import { consentAllows, type ReaderConsentRecord } from "@sentropic/artifacts/server/consent";
import type { ArtifactReaderStore } from "@sentropic/artifacts/server/reader-store";

/**
 * Reader consent LOT 1 — persistent opening consent through the generic
 * host port.
 *
 * One host-declared scope (`reader` v1) authorizes the opening bypass: a
 * live row at the current scope version plus fresh rights (the approval
 * re-reads `getRights` on the same call) skips the neutral screen. Consent
 * rows never record data use: no basket identifier, no query, no page data,
 * no session/device/network data. Revocation keeps history: re-grant after
 * revoke mints a new row.
 */

/** Host-declared scope id: what the consent covers (opening shared pages). */
export const READER_CONSENT_SCOPE_ID = "reader";
/** Scope version: widening the opening contract bumps it and re-arms every screen. */
export const READER_CONSENT_SCOPE_VERSION = "v1";

export interface ReaderConsentService {
  readonly store: ArtifactReaderStore;
  findLiveConsent(readerAccountId: string, artifactId: string): Promise<ReaderConsentRecord | undefined>;
  /** First-party gesture on the control-origin screen; converges on a live row. */
  grantOnScreen(readerAccountId: string, artifactId: string): Promise<ReaderConsentRecord>;
}

export function readerConsentKey(storageScopeId: string, readerAccountId: string, artifactId: string) {
  return { storageScopeId, readerAccountId, artifactId,
    scopeId: READER_CONSENT_SCOPE_ID, scopeVersion: READER_CONSENT_SCOPE_VERSION };
}

/** Live row at the current scope version authorizes the bypass (fresh rights verified by the caller). */
export function consentAllowsOpening(record: ReaderConsentRecord | undefined): record is ReaderConsentRecord {
  return consentAllows(record, READER_CONSENT_SCOPE_VERSION);
}

export function createReaderConsentService(pool: pg.Pool, storageScopeId: string,
  now: () => string = () => new Date().toISOString()): ReaderConsentService {
  const store = createPostgresReaderConsentStore(pool);
  return {
    store,
    findLiveConsent: (readerAccountId, artifactId) =>
      store.findLiveConsent(readerConsentKey(storageScopeId, readerAccountId, artifactId)),
    grantOnScreen: (readerAccountId, artifactId) => store.grantConsent({
      ...readerConsentKey(storageScopeId, readerAccountId, artifactId),
      consentId: randomUUID(), grantedAt: now(), grantedVia: "reader_screen",
    }),
  };
}
