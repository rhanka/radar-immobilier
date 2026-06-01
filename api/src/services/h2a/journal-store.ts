/**
 * EV10: the radar coordination journal, backed by REAL `@sentropic/h2a`.
 *
 * Each radar decision (qualifier / surveiller / approcher) is
 * recorded as a pair of hash-chained, ed25519-signed h2a journal entries:
 *   1. a PRINCIPAL `propose` entry carrying the decision artifact, then
 *   2. a CONDUCTOR `accept` entry acknowledging it.
 *
 * The chain is built with `createJournalEntry` / `appendJournalEntry` (real
 * `prevHash` + `contentHash` linkage from the package) and each entry is signed
 * with `signCanonical` over its canonical payload. `verifyJournalChain` +
 * `verifyCanonical` re-prove integrity on every read; no simulated state.
 */

import {
  appendJournalEntry,
  createJournalEntry,
  signCanonical,
  verifyCanonical,
  verifyJournalChain,
  type H2AActorRef,
  type H2AEnvelopeType,
  type H2AJournalEntry,
  type H2AJournalPayload,
} from "@sentropic/h2a";

import { createKeyring, type H2AKeyring } from "./keyring.js";
import { RADAR_POLICY_IDS, RADAR_SCOPE } from "./policy.js";

/** A radar decision kind a human (PRINCIPAL) may take on an entity. */
export type DecisionKind = "qualifier" | "surveiller" | "approcher";

/** The body carried by a PRINCIPAL `propose` entry. */
export interface DecisionBody {
  readonly kind: DecisionKind;
  readonly entity: string;
  readonly rationale?: string;
}

/** The body carried by a CONDUCTOR `accept` entry. */
export interface AckBody {
  readonly acknowledges: DecisionKind;
  readonly entity: string;
  readonly note: string;
}

/** Per-entry signature-verification outcome surfaced to the read API. */
export interface JournalEntryView {
  readonly entry: H2AJournalEntry;
  readonly signatureValid: boolean;
}

/** Snapshot returned by the read API: the verified chain + actors + policy. */
export interface JournalSnapshot {
  readonly protocol: string;
  readonly version: string;
  readonly scope: string;
  readonly policyIds: readonly string[];
  readonly actors: ReadonlyArray<{ by: string; role: string }>;
  readonly entries: readonly JournalEntryView[];
  readonly chainValid: boolean;
  readonly chainReason?: string;
}

/** The radar coordination journal store. */
export interface H2AJournalStore {
  /** Record a PRINCIPAL decision + its CONDUCTOR acknowledgement. */
  recordDecision(input: DecisionBody): JournalSnapshot;
  /** The verified journal snapshot (chain + per-entry signatures). */
  snapshot(): JournalSnapshot;
}

const ackNote = (kind: DecisionKind): string => {
  switch (kind) {
    case "qualifier":
      return "Decision journalisee : qualification engagee sous la POLICY radar.";
    case "approcher":
      return "Decision journalisee : approche soumise a la frontiere courtage (OACIQ).";
    case "surveiller":
    default:
      return "Decision journalisee : entite placee sous surveillance.";
  }
};

/** Build a radar h2a journal store with a fresh per-process keyring. */
export function createJournalStore(keyring: H2AKeyring = createKeyring()): H2AJournalStore {
  const entries: H2AJournalEntry[] = [];
  let sequence = 0;

  const actorRef = (kind: DecisionKind | "ack"): H2AActorRef => {
    const isPrincipal = kind !== "ack";
    const signer = isPrincipal ? keyring.principal : keyring.conductor;
    return { instance: signer.by, role: signer.role, scope: RADAR_SCOPE };
  };

  /** Append one signed, hash-chained entry to the in-memory chain. */
  const append = (
    type: H2AEnvelopeType,
    actor: H2AActorRef,
    privateKeyPem: string,
    by: string,
    body: DecisionBody | AckBody,
  ): H2AJournalEntry => {
    // Sign the unsigned payload first, then fold the signature INTO the payload
    // so the journal `contentHash` (computed by createJournalEntry over the
    // whole payload, signatures included) covers the signature too; that is
    // what `verifyJournalChain` re-checks via `stripFrame` on read.
    const unsigned: H2AJournalPayload = {
      id: `radar:decision:${sequence}`,
      type,
      actor,
      body,
      createdAt: new Date().toISOString(),
      policyIds: [...RADAR_POLICY_IDS],
    };
    const signature = signCanonical(unsigned, { by, privateKeyPem });
    const payload: H2AJournalPayload = { ...unsigned, signatures: [signature] };

    const previous = entries[entries.length - 1];
    const entry = previous
      ? appendJournalEntry(previous, payload)
      : createJournalEntry(payload);
    entries.push(entry);
    sequence += 1;
    return entry;
  };

  const recordDecision = (input: DecisionBody): JournalSnapshot => {
    append(
      "propose",
      actorRef(input.kind),
      keyring.principal.privateKeyPem,
      keyring.principal.by,
      input,
    );
    const ack: AckBody = {
      acknowledges: input.kind,
      entity: input.entity,
      note: ackNote(input.kind),
    };
    append("accept", actorRef("ack"), keyring.conductor.privateKeyPem, keyring.conductor.by, ack);
    return snapshot();
  };

  const snapshot = (): JournalSnapshot => {
    const chain = verifyJournalChain(entries);
    const views: JournalEntryView[] = entries.map((entry) => {
      const sig = entry.signatures?.[0];
      const pub = sig ? keyring.publicKeyFor(sig.by) : undefined;
      // Reconstruct the exact `unsigned` payload that was signed: drop the
      // journal frame (protocol/version/sequence/prevHash/contentHash) AND the
      // signatures, then verify over that canonical value.
      const {
        protocol: _protocol,
        version: _version,
        sequence: _sequence,
        prevHash: _prevHash,
        contentHash: _contentHash,
        signatures: _signatures,
        ...unsigned
      } = entry;
      const signatureValid = Boolean(sig && pub && verifyCanonical(unsigned, sig, pub));
      return { entry, signatureValid };
    });
    return {
      protocol: entries[0]?.protocol ?? "sentropic.h2a",
      version: entries[0]?.version ?? "0.1",
      scope: RADAR_SCOPE,
      policyIds: [...RADAR_POLICY_IDS],
      actors: [
        { by: keyring.principal.by, role: keyring.principal.role },
        { by: keyring.conductor.by, role: keyring.conductor.role },
      ],
      entries: views,
      chainValid: chain.ok,
      ...(chain.ok ? {} : { chainReason: chain.reason }),
    };
  };

  return { recordDecision, snapshot };
}
