/**
 * m5 / UAT round2 — Défaut n° de zone + migration du legacy-state.
 *
 * Les 4 cas demandés par le PO (vérifiés ici sur la RÉSOLUTION pure ; le rendu
 * carte correspondant est couvert par e2e-qa/legend-number-toggle.spec.ts) :
 *   (1) storage vierge                → zone# (défaut)
 *   (2) anciennes clés à false        → zone# (le legacy « masqué » ne réimpose rien)
 *   (3) clé explicite `lot`           → lot (persiste, distinct du défaut)
 *   (4) reload / relecture            → mode stable, jamais réimposé masqué
 */
import { describe, it, expect } from "vitest";
import {
  LEGEND_LABEL_MODE_LS_KEY,
  LEGACY_ZONE_LABELS_LS_KEY,
  LEGACY_LOT_LABELS_LS_KEY,
  resolveLegendLabelMode,
  migrateLegacyLegendLabelKeys,
  persistLegendLabelMode,
} from "./legend-label-mode.js";

/** Faux localStorage minimal, isolé par test. */
function makeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    has: (k: string) => map.has(k),
  };
}

describe("resolveLegendLabelMode — défaut zone + migration legacy", () => {
  it("(1) storage vierge → zone# par défaut", () => {
    expect(resolveLegendLabelMode(makeStorage())).toBe("zone");
  });

  it("(1b) storage indisponible (null/undefined) → zone#", () => {
    expect(resolveLegendLabelMode(null)).toBe("zone");
    expect(resolveLegendLabelMode(undefined)).toBe("zone");
  });

  it("(2) anciennes clés à false → zone# (le legacy « masqué » ne réimpose rien)", () => {
    const storage = makeStorage({
      [LEGACY_ZONE_LABELS_LS_KEY]: "0",
      [LEGACY_LOT_LABELS_LS_KEY]: "0",
    });
    expect(resolveLegendLabelMode(storage)).toBe("zone");
  });

  it("(2b) ancienne clé lot=1 ne force PAS le mode lot (jamais réimposé depuis le legacy)", () => {
    const storage = makeStorage({
      [LEGACY_LOT_LABELS_LS_KEY]: "1",
      [LEGACY_ZONE_LABELS_LS_KEY]: "0",
    });
    expect(resolveLegendLabelMode(storage)).toBe("zone");
  });

  it("(3) clé explicite `lot` → lot (persiste, distinct du défaut)", () => {
    const storage = makeStorage({ [LEGEND_LABEL_MODE_LS_KEY]: "lot" });
    expect(resolveLegendLabelMode(storage)).toBe("lot");
  });

  it("(3b) clé explicite `zone` → zone (choix explicite honoré)", () => {
    const storage = makeStorage({ [LEGEND_LABEL_MODE_LS_KEY]: "zone" });
    expect(resolveLegendLabelMode(storage)).toBe("zone");
  });

  it("(3c) la clé round-2 prime sur d'éventuelles clés legacy résiduelles", () => {
    const storage = makeStorage({
      [LEGEND_LABEL_MODE_LS_KEY]: "lot",
      [LEGACY_ZONE_LABELS_LS_KEY]: "0",
      [LEGACY_LOT_LABELS_LS_KEY]: "0",
    });
    expect(resolveLegendLabelMode(storage)).toBe("lot");
  });

  it("(4) reload : la relecture rend le même mode (stable, jamais réimposé masqué)", () => {
    const storage = makeStorage();
    // 1er chargement (vierge) → zone, puis choix explicite lot persisté.
    expect(resolveLegendLabelMode(storage)).toBe("zone");
    persistLegendLabelMode(storage, "lot");
    // « reload » : nouvelle relecture → lot conservé.
    expect(resolveLegendLabelMode(storage)).toBe("lot");
    // reset explicite en zone → conservé aussi.
    persistLegendLabelMode(storage, "zone");
    expect(resolveLegendLabelMode(storage)).toBe("zone");
  });
});

describe("migrateLegacyLegendLabelKeys — purge cosmétique du legacy-state", () => {
  it("supprime les deux clés legacy et laisse la clé round-2 intacte", () => {
    const storage = makeStorage({
      [LEGACY_ZONE_LABELS_LS_KEY]: "0",
      [LEGACY_LOT_LABELS_LS_KEY]: "1",
      [LEGEND_LABEL_MODE_LS_KEY]: "lot",
    });
    migrateLegacyLegendLabelKeys(storage);
    expect(storage.has(LEGACY_ZONE_LABELS_LS_KEY)).toBe(false);
    expect(storage.has(LEGACY_LOT_LABELS_LS_KEY)).toBe(false);
    // La purge ne change pas le mode résolu.
    expect(resolveLegendLabelMode(storage)).toBe("lot");
  });

  it("no-op si storage indisponible ou clés absentes", () => {
    expect(() => migrateLegacyLegendLabelKeys(null)).not.toThrow();
    const storage = makeStorage();
    expect(() => migrateLegacyLegendLabelKeys(storage)).not.toThrow();
  });
});
