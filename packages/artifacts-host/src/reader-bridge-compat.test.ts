import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { isLegacyReaderBridge, upgradeLegacyReaderBridge } from "./reader-bridge-compat.js";

/**
 * Lot I2 B2: pages published with the pre-I2 reader bridge must keep
 * working without republication. The fixture is the exact
 * STARTER_READER_JS published before I2 (base a2430d5fb); the host upgrades
 * it at serve time so the first H5 call reaches /__reader/consent instead
 * of looping on « Réouvrir ».
 */
const LEGACY_BRIDGE = readFileSync(new URL("./reader-bridge-legacy.fixture.txt", import.meta.url), "utf8");

describe("legacy reader bridge compatibility", () => {
  it("should recognize the exact published pre-I2 bridge", () => {
    expect(LEGACY_BRIDGE).toContain("window.ImmoReader");
    expect(LEGACY_BRIDGE).not.toContain("basket_consent_required");
    expect(isLegacyReaderBridge(LEGACY_BRIDGE)).toBe(true);
  });

  it("should upgrade the legacy bridge to the deferred-consent flow", () => {
    const upgraded = upgradeLegacyReaderBridge(LEGACY_BRIDGE);
    expect(upgraded).not.toBeNull();
    expect(upgraded!).toContain('basket_consent_required: "consent",');
    expect(upgraded!).toContain("var consentRedirected = false;");
    expect(upgraded!).toContain('location.assign("/__reader/consent")');
    expect(upgraded!).toContain("var kind = kindOf(code, response.status);");
    // The old token flow is untouched: same grant cycle, same surface.
    expect(upgraded!).toContain("window.ImmoReader");
    expect(upgraded!).toContain("/__reader/renew");
    expect(upgraded!).toContain("x-preview-grant");
  });

  it("should keep the upgraded bridge syntactically valid and idempotent", () => {
    const upgraded = upgradeLegacyReaderBridge(LEGACY_BRIDGE)!;
    expect(() => new Script(upgraded)).not.toThrow();
    expect(isLegacyReaderBridge(upgraded)).toBe(false);
    expect(upgradeLegacyReaderBridge(upgraded)).toBeNull();
  });

  it("should leave current bridges, custom clients and ambiguous bodies unchanged", () => {
    const current = `${LEGACY_BRIDGE}\n// basket_consent_required handled`;
    expect(isLegacyReaderBridge(current)).toBe(false);
    expect(upgradeLegacyReaderBridge(current)).toBeNull();
    const custom = "window.ImmoReader = { read: () => fetch('/api') };";
    expect(isLegacyReaderBridge(custom)).toBe(false);
    expect(upgradeLegacyReaderBridge(custom)).toBeNull();
    // Markers present but no surgical anchor: serve byte-identical, never half-patched.
    const ambiguous = 'window.ImmoReader = 1; delegated_scope_refused; var x = "custom bridge";';
    expect(isLegacyReaderBridge(ambiguous)).toBe(true);
    expect(upgradeLegacyReaderBridge(ambiguous)).toBeNull();
  });
});
