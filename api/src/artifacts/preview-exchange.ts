/**
 * Preview ticket exchange (ARTEFACTS A6/H5).
 *
 * Consumes a single-use ticket only against the live authority: release,
 * profile name, policy revision, profile fingerprint and per-artifact reader
 * approval must all match before any session or grant is emitted. Any
 * substitution between init and exchange fails closed; the ticket stays
 * consumed so it can never be replayed.
 */
import type { AuthorityReader } from "./reader-profile.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import type { PreviewTicket } from "./preview-tickets.js";

export async function validateTicketForExchange(
  ticket: PreviewTicket,
  authority: AuthorityReader,
): Promise<PreviewTicket | null> {
  try {
    const version = await authority.getAuthorizationVersion(ticket.artifactId);
    if (!version) return null;
    const release = await authority.getRelease(ticket.artifactId);
    if (!release || release.artifactId !== ticket.artifactId || release.releaseId !== ticket.releaseId) return null;
    const profile = await authority.getProfile(ticket.artifactId);
    if (!profile || profile.name !== ticket.profileName) return null;
    if (profile.policyRevision !== ticket.policyRevision) return null;
    if (fingerprintReaderProfile(profile) !== ticket.profileFingerprint) return null;
    const rights = await authority.getRights(ticket.readerSub, ticket.artifactId);
    if (!rights || !rights.approved) return null;
    if (rights.readerSub !== ticket.readerSub || rights.artifactId !== ticket.artifactId) return null;
    if (await authority.getAuthorizationVersion(ticket.artifactId) !== version) return null;
    return ticket;
  } catch {
    return null;
  }
}
