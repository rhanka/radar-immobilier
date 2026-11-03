// Lot I1 — unit tests for the signed admission snapshot (no DB, no network).
import { describe, expect, it } from "vitest";
import {
  buildAdmissionSnapshot,
  canonicalSnapshotBytes,
  generateAdmissionKeypair,
  parsePrivateKeyEntry,
  parsePublicKeyEntry,
  parsePublicKeyList,
  signSnapshot,
  SnapshotRejectedError,
  verifySnapshot,
  type AdmissionPayload,
} from "./snapshot.js";

function keypair() {
  const pair = generateAdmissionKeypair();
  const privateKey = parsePrivateKeyEntry(pair.privateEntry);
  const publicKeys = parsePublicKeyList(pair.publicEntry);
  return { pair, privateKey, publicKeys };
}

const ROWS = [
  { email: "Zoe@Example.CA", name: "Zoe", status: "approved", isAdmin: false,
    createdAt: new Date("2026-01-02T03:04:05.000Z"), approvedAt: new Date("2026-02-03T04:05:06.000Z") },
  { email: "adam@example.ca", name: null, status: "approved", isAdmin: true,
    createdAt: "2026-01-01T00:00:00.000Z", approvedAt: null },
  // Dropped: no usable email.
  { email: null, name: "Ghost", status: "approved", isAdmin: false, createdAt: null, approvedAt: null },
  { email: "  ", name: "Blank", status: "approved", isAdmin: false, createdAt: null, approvedAt: null },
  // Dropped: unknown status is never guessed.
  { email: "weird@example.ca", name: null, status: "archived", isAdmin: false, createdAt: null, approvedAt: null },
];

describe("buildAdmissionSnapshot", () => {
  it("should keep minimal fields only when rows are valid", () => {
    const { pair } = keypair();
    const payload = buildAdmissionSnapshot(ROWS, {
      kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true,
    });
    expect(payload.version).toBe(1);
    expect(payload.kid).toBe(pair.kid);
    expect(payload.full).toBe(true);
    expect(payload.entries).toHaveLength(2);
    // Sorted by normalised email: adam before zoe.
    expect(payload.entries[0]!.email).toBe("adam@example.ca");
    expect(payload.entries[0]!.role).toBe("admin");
    expect(payload.entries[0]!.approvedAt).toBeNull();
    expect(payload.entries[1]!.email).toBe("Zoe@Example.CA");
    expect(payload.entries[1]!.name).toBe("Zoe");
    expect(payload.entries[1]!.createdAt).toBe("2026-01-02T03:04:05.000Z");
    // No sub, no business content.
    expect(JSON.stringify(payload)).not.toContain("sub");
  });
});

describe("signSnapshot / verifySnapshot", () => {
  it("should verify a freshly signed envelope", () => {
    const { pair, privateKey, publicKeys } = keypair();
    const payload = buildAdmissionSnapshot(ROWS, {
      kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: false,
    });
    const envelope = signSnapshot(payload, privateKey.key);
    expect(verifySnapshot(envelope, publicKeys)).toEqual(payload);
  });

  it("should reject a tampered entry", () => {
    const { pair, privateKey, publicKeys } = keypair();
    const payload = buildAdmissionSnapshot(ROWS, {
      kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: false,
    });
    const envelope = signSnapshot(payload, privateKey.key);
    const tampered = {
      ...envelope,
      payload: { ...envelope.payload, entries: [{ ...envelope.payload.entries[0]!, status: "rejected" as const }] },
    };
    expect(() => verifySnapshot(tampered, publicKeys)).toThrowError(SnapshotRejectedError);
    try {
      verifySnapshot(tampered, publicKeys);
    } catch (error) {
      expect((error as SnapshotRejectedError).reason).toBe("invalid_signature");
    }
  });

  it("should reject a signature from another key", () => {
    const { pair, privateKey } = keypair();
    const other = keypair();
    const payload = buildAdmissionSnapshot(ROWS, {
      kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: false,
    });
    // Signed by `other`, but the kid claims `pair`: verification uses pair's
    // key and must fail the signature check.
    const envelope = signSnapshot(payload, other.privateKey.key);
    expect(() => verifySnapshot({ payload, signature: envelope.signature }, other.publicKeys)).toThrowError(
      /unknown_kid/,
    );
    const relabelled: AdmissionPayload = { ...payload, kid: other.pair.kid };
    const forged = signSnapshot(relabelled, privateKey.key);
    try {
      verifySnapshot(forged, other.publicKeys);
      expect.unreachable();
    } catch (error) {
      expect((error as SnapshotRejectedError).reason).toBe("invalid_signature");
    }
  });

  it("should reject an unknown kid", () => {
    const { pair, privateKey, publicKeys } = keypair();
    const payload = buildAdmissionSnapshot(ROWS, {
      kid: "unknownkid123456", issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true,
    });
    void pair;
    const envelope = signSnapshot(payload, privateKey.key);
    try {
      verifySnapshot(envelope, publicKeys);
      expect.unreachable();
    } catch (error) {
      expect((error as SnapshotRejectedError).reason).toBe("unknown_kid");
    }
  });

  it("should reject a malformed envelope", () => {
    const { publicKeys } = keypair();
    for (const bad of [null, {}, { payload: {}, signature: "x" }, { payload: null, signature: "x" }]) {
      try {
        verifySnapshot(bad, publicKeys);
        expect.unreachable();
      } catch (error) {
        expect((error as SnapshotRejectedError).reason).toBe("envelope_malformed");
      }
    }
  });

  it("should accept any configured key during rotation", () => {
    const first = keypair();
    const second = keypair();
    const combined = parsePublicKeyList(`${first.pair.publicEntry}, ${second.pair.publicEntry}`);
    const payload = buildAdmissionSnapshot(ROWS, {
      kid: second.pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true,
    });
    const envelope = signSnapshot(payload, second.privateKey.key);
    expect(verifySnapshot(envelope, combined).kid).toBe(second.pair.kid);
    expect(combined.size).toBe(2);
    void first;
  });

  it("should reject malformed key entries", () => {
    expect(() => parsePrivateKeyEntry("no-dot")).toThrowError(/malformed/);
    expect(() => parsePublicKeyEntry("kid.@@@")).toThrowError(/malformed/);
    const { pair } = keypair();
    const tamperedKid = `otherkid.${pair.publicEntry.split(".")[1]}`;
    expect(() => parsePublicKeyEntry(tamperedKid)).toThrowError(/kid_mismatch/);
  });

  it("should produce stable canonical bytes regardless of entry order", () => {
    const { pair } = keypair();
    const a = buildAdmissionSnapshot([...ROWS].reverse(), {
      kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true,
    });
    const b = buildAdmissionSnapshot(ROWS, {
      kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true,
    });
    expect(canonicalSnapshotBytes(a).equals(canonicalSnapshotBytes(b))).toBe(true);
  });
});

describe("buildAdmissionSnapshot — email dedup (F5)", () => {
  const DUPS = [
    { email: "DUP@example.ca", name: "Old", status: "rejected", isAdmin: false,
      createdAt: "2026-01-01T00:00:00.000Z", approvedAt: null },
    { email: "dup@example.ca", name: "New", status: "approved", isAdmin: false,
      createdAt: "2026-02-01T00:00:00.000Z", approvedAt: "2026-03-01T00:00:00.000Z" },
    { email: "  dup@Example.CA  ", name: "Messy", status: "suspended", isAdmin: false,
      createdAt: "2026-04-01T00:00:00.000Z", approvedAt: null },
  ];

  it("should collapse case/whitespace duplicates to the single approved entry", () => {
    const { pair } = keypair();
    const payload = buildAdmissionSnapshot(DUPS, {
      kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true,
    });
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({ status: "approved", name: "New" });
  });

  it("should pick the same winner regardless of input order", () => {
    const { pair } = keypair();
    const opts = { kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true as const };
    const first = buildAdmissionSnapshot(DUPS, opts);
    const shuffled = buildAdmissionSnapshot([DUPS[2]!, DUPS[0]!, DUPS[1]!], opts);
    expect(shuffled.entries).toEqual(first.entries);
    expect(canonicalSnapshotBytes(shuffled).equals(canonicalSnapshotBytes(first))).toBe(true);
  });

  it("should keep distinct emails sorted by normalised email", () => {
    const { pair } = keypair();
    const payload = buildAdmissionSnapshot(
      [
        { email: "Zoe@Example.ca", name: null, status: "approved", isAdmin: false, createdAt: null, approvedAt: null },
        { email: "adam@example.ca", name: null, status: "approved", isAdmin: false, createdAt: null, approvedAt: null },
        { email: "DUP@example.ca", name: "Old", status: "rejected", isAdmin: false, createdAt: null, approvedAt: null },
        { email: "dup@example.ca", name: "New", status: "approved", isAdmin: false, createdAt: null, approvedAt: null },
      ],
      { kid: pair.kid, issuedAt: new Date("2026-11-03T12:00:00.000Z"), full: true },
    );
    expect(payload.entries.map((entry) => entry.email)).toEqual([
      "adam@example.ca",
      "dup@example.ca",
      "Zoe@Example.ca",
    ]);
  });
});
