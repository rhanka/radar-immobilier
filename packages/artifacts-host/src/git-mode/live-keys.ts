import { hkdfSync } from "node:crypto";
import type { LiveKeyPort } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";

/**
 * Live draft keys (A-LIVE v2 §5, LiveKeyPort implemented by immo).
 *
 * - Sealed secret: IMMO_ARTIFACTS_LIVE_DRAFT_KEYS = `version=base64url,...`,
 *   each value exactly 32 raw bytes; IMMO_ARTIFACTS_LIVE_DRAFT_KEY_CURRENT
 *   names the version used for new drafts. Old versions stay listed until no
 *   draft references them (rotation by overlap).
 * - One data key per binding: HKDF-SHA256 of the version key over the
 *   binding identity (storageScopeId, artifactId, bindingGeneration), so a
 *   key never serves two bindings.
 * - The provider encrypts with AES-256-GCM and binds the AAD
 *   [storageScopeId, artifactId, bindingGeneration, revision, baseHeadSha,
 *   expiresAt, digest, keyVersion]; immo only supplies the key. No key ever
 *   reaches a worker.
 */
export interface LiveDraftKeyring { readonly current: string; readonly keys: ReadonlyMap<string, Uint8Array> }

const VERSION = /^[A-Za-z0-9._-]{1,64}$/;

export function parseLiveDraftKeyring(raw: string | undefined, current: string | undefined): LiveDraftKeyring | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const keys = new Map<string, Uint8Array>();
  for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    const version = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    const key = Buffer.from(value, "base64url");
    if (separator < 1 || !VERSION.test(version) || keys.has(version) || key.byteLength !== 32 ||
      key.toString("base64url") !== value.replace(/=+$/, "")) throw new Error("artifact_live_draft_keys_invalid");
    keys.set(version, new Uint8Array(key));
  }
  const selected = current?.trim();
  if (!selected || !keys.has(selected)) throw new Error("artifact_live_draft_key_current_invalid");
  return { current: selected, keys };
}

interface LiveIdentity { storageScopeId: string; artifactId: string; bindingGeneration: number }

const derive = (master: Uint8Array, identity: LiveIdentity) => new Uint8Array(hkdfSync("sha256", master,
  "immo.live.draft.v1", JSON.stringify([identity.storageScopeId, identity.artifactId, identity.bindingGeneration]), 32));

export function createSealedLiveKeys(keyring: LiveDraftKeyring): LiveKeyPort {
  return {
    async current(identity) {
      return { version: keyring.current, key: derive(keyring.keys.get(keyring.current)!, identity) };
    },
    async resolve(identity, version) {
      const master = keyring.keys.get(version);
      if (!master) throw new ArtifactOperationError("provider_unavailable");
      return derive(master, identity);
    },
  };
}
