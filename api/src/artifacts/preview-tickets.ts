/**
 * Opaque single-use preview tickets (ARTEFACTS A6/H5).
 *
 * A ticket binds one validated init to one browser exchange. It is consumed
 * atomically (a second concurrent consume fails), lives at most 60 seconds,
 * and carries no authority by itself: the exchange rereads approval, ACL and
 * policy before minting a session. Cross-process races need the A1 technical
 * store binding; this in-memory store is the unit seam.
 */
import { randomBytes } from "node:crypto";
import { fingerprintReaderProfile, type ReaderProfile } from "./reader-profile.js";
import type { PwIdentityDomain } from "./write-intent-principal.js";

export const PREVIEW_TICKET_TTL_MS = 60_000;

export interface PreviewTicket {
  readonly writeIdentity?: PwIdentityDomain;
  readonly browserBinding: string;
  readonly ticket: string;
  readonly origin: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly profileName: string;
  readonly policyRevision: string;
  readonly profileFingerprint: string;
  readonly readerSub: string;
  readonly returnTarget: string;
  readonly expiresAt: number;
}

export interface TicketMint {
  readonly writeIdentity?: PwIdentityDomain;
  readonly browserBinding: string;
  readonly origin: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly profileName: string;
  readonly policyRevision: string;
  readonly profileFingerprint: string;
  readonly readerSub: string;
  readonly returnTarget: string;
}

export interface TicketStoreOptions {
  readonly now?: () => number;
  readonly random?: () => string;
}

/** Refuse any substitution of the approved profile between init and exchange. */
export function isTicketProfileCurrent(
  ticket: Pick<PreviewTicket, "profileName" | "policyRevision" | "profileFingerprint">,
  profile: ReaderProfile,
): boolean {
  return ticket.profileName === profile.name
    && ticket.policyRevision === profile.policyRevision
    && ticket.profileFingerprint === fingerprintReaderProfile(profile);
}

export function createTicketStore(options: TicketStoreOptions = {}): {
  mint: (input: TicketMint) => PreviewTicket;
  consume: (ticket: string, browserBinding: string) => PreviewTicket | null;
  readonly size: () => number;
} {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => randomBytes(32).toString("hex"));
  const live = new Map<string, PreviewTicket>();

  return {
    mint(input: TicketMint): PreviewTicket {
      if (input.browserBinding.length < 32) throw new Error("Invalid browser binding");
      const issuedAt = now();
      const record: PreviewTicket = {
        ...input,
        ticket: random(),
        expiresAt: issuedAt + PREVIEW_TICKET_TTL_MS,
      };
      live.set(record.ticket, record);
      return record;
    },
    consume(ticket: string, browserBinding: string): PreviewTicket | null {
      const record = live.get(ticket);
      if (!record) return null;
      if (record.browserBinding !== browserBinding) return null;
      live.delete(ticket);
      if (record.expiresAt <= now()) return null;
      return record;
    },
    size: () => live.size,
  };
}
