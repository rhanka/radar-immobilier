import { describe, expect, it } from "vitest";
import { createSealedLiveKeys, parseLiveDraftKeyring } from "./live-keys.js";

const key = (fill: number) => Buffer.alloc(32, fill).toString("base64url");
const identity = { storageScopeId: "s", artifactId: "11111111-1111-4111-8111-111111111111", bindingGeneration: 1 };

describe("sealed live draft keys", () => {
  it("parses the versioned keyring and refuses malformed entries", () => {
    expect(parseLiveDraftKeyring(undefined, undefined)).toBeUndefined();
    expect(parseLiveDraftKeyring(`v1=${key(1)},v2=${key(2)}`, "v2")?.current).toBe("v2");
    expect(() => parseLiveDraftKeyring(`v1=${Buffer.alloc(16).toString("base64url")}`, "v1")).toThrow("artifact_live_draft_keys_invalid");
    expect(() => parseLiveDraftKeyring(`v1=${key(1)},v1=${key(2)}`, "v1")).toThrow("artifact_live_draft_keys_invalid");
    expect(() => parseLiveDraftKeyring(`v1=${key(1)}`, "v9")).toThrow("artifact_live_draft_key_current_invalid");
  });

  it("derives one 32-byte data key per binding and resolves older versions", async () => {
    const keys = createSealedLiveKeys(parseLiveDraftKeyring(`v1=${key(1)},v2=${key(2)}`, "v2")!);
    const current = await keys.current(identity);
    expect(current.version).toBe("v2");
    expect(current.key.byteLength).toBe(32);
    expect(Buffer.from(await keys.resolve(identity, "v2")).equals(Buffer.from(current.key))).toBe(true);
    const other = await keys.current({ ...identity, bindingGeneration: 2 });
    expect(Buffer.from(other.key).equals(Buffer.from(current.key))).toBe(false);
    expect(Buffer.from(await keys.resolve(identity, "v1")).equals(Buffer.from(current.key))).toBe(false);
    await expect(keys.resolve(identity, "v0")).rejects.toMatchObject({ kind: "provider_unavailable" });
  });
});
