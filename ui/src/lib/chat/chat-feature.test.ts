/**
 * chat-feature — feature-flag du chat carte (décision owner 2026-09-07).
 *
 * Teste le coeur PUR (`chatFeatureFlagOn`, sans env) + le seam `isChatEnabled()`
 * (lecture de `VITE_CHAT_ENABLED` via `vi.stubEnv`). Contrat : DÉFAUT OFF, ON
 * UNIQUEMENT pour la valeur exacte `"true"` (réversible en flippant le flag).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { chatFeatureFlagOn, isChatEnabled } from "./chat-feature.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chatFeatureFlagOn — coeur pur", () => {
  it("ON uniquement pour la valeur exacte \"true\"", () => {
    expect(chatFeatureFlagOn("true")).toBe(true);
  });

  it("OFF pour absent / vide / toute autre valeur (défaut sûr)", () => {
    expect(chatFeatureFlagOn(undefined)).toBe(false);
    expect(chatFeatureFlagOn(null)).toBe(false);
    expect(chatFeatureFlagOn("")).toBe(false);
    expect(chatFeatureFlagOn("false")).toBe(false);
    expect(chatFeatureFlagOn("1")).toBe(false);
    expect(chatFeatureFlagOn("TRUE")).toBe(false); // strict (pas de coercition)
    expect(chatFeatureFlagOn("yes")).toBe(false);
  });
});

describe("isChatEnabled — seam VITE_CHAT_ENABLED", () => {
  it("DÉFAUT OFF quand le flag est absent", () => {
    vi.stubEnv("VITE_CHAT_ENABLED", "");
    expect(isChatEnabled()).toBe(false);
  });

  it("ON quand VITE_CHAT_ENABLED === \"true\" (réversible)", () => {
    vi.stubEnv("VITE_CHAT_ENABLED", "true");
    expect(isChatEnabled()).toBe(true);
  });

  it("OFF pour toute autre valeur du flag", () => {
    vi.stubEnv("VITE_CHAT_ENABLED", "false");
    expect(isChatEnabled()).toBe(false);
  });
});
