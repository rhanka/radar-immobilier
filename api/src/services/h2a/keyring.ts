/**
 * EV10: per-process ed25519 keyring for the radar h2a journal.
 *
 * Two actors sign the radar coordination journal:
 *   - PRINCIPAL: the human (the only role a human ever holds; the AI is never
 *     PRINCIPAL). Issues the decisions (qualifier / surveiller / approcher).
 *   - CONDUCTOR: the orchestrating AI. Acknowledges and journals on behalf of
 *     the system, never as PRINCIPAL.
 *
 * Keys are generated once per process. The demo has no key-persistence layer
 * (matches the broader "no persistence yet" deferral), so a restart mints a
 * fresh keyring and resets the journal; the truth is re-derived, never faked.
 */

import { generateKeyPairSync } from "node:crypto";

import type { H2ARole } from "@sentropic/h2a";

/** A signing identity: an h2a role bound to an ed25519 PEM key pair. */
export interface H2AKeyPair {
  readonly by: string;
  readonly role: H2ARole;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}

/** The radar keyring: the two actors that may sign the coordination journal. */
export interface H2AKeyring {
  readonly principal: H2AKeyPair;
  readonly conductor: H2AKeyPair;
  /** Public key (PEM) for a signer `by` id, for chain verification. */
  publicKeyFor(by: string): string | undefined;
}

const mint = (by: string, role: H2ARole): H2AKeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    by,
    role,
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
};

/** Build a fresh per-process keyring (PRINCIPAL human + CONDUCTOR AI). */
export function createKeyring(): H2AKeyring {
  const principal = mint("principal@radar", "PRINCIPAL");
  const conductor = mint("conductor@radar", "CONDUCTOR");
  const byKey = new Map<string, string>([
    [principal.by, principal.publicKeyPem],
    [conductor.by, conductor.publicKeyPem],
  ]);
  return {
    principal,
    conductor,
    publicKeyFor: (by) => byKey.get(by),
  };
}
