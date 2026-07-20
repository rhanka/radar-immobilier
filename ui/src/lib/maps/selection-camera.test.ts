/**
 * m4 — Décision de cadrage caméra à la sélection.
 *
 * Scénario PO : lot A sélectionné + zoomé, puis sélection d'un lot B → on cadre
 * sur lot B, JAMAIS de repli vers la zone/ville (pas de dézoom/reset).
 */
import { describe, it, expect } from "vitest";
import { makeKey } from "./selection-bucket.js";
import { resolveSelectionCameraTarget } from "./selection-camera.js";

const CITY = "delson";
const lotKey = (noLot: string) => makeKey("lot", `${CITY}/${noLot}`);
const zoneKey = (code: string) => makeKey("zone", `${CITY}/${code}`);

describe("resolveSelectionCameraTarget — cadrage cohérent zone/lot", () => {
  it("zone → cadrée sur son étendue (sans option)", () => {
    expect(resolveSelectionCameraTarget(zoneKey("VP-101"))).toEqual({
      kind: "zone",
      citySlug: CITY,
      code: "VP-101",
    });
  });

  it("lot + fitLot → cadré sur le lot (clic carte / clic liste)", () => {
    expect(resolveSelectionCameraTarget(lotKey("4 516 943"), { fitLot: true })).toEqual({
      kind: "lot",
      citySlug: CITY,
      noLot: "4 516 943",
    });
  });

  it("lot sans fitLot → aucun cadrage (auto-sélection du 1er lot d'une ville)", () => {
    expect(resolveSelectionCameraTarget(lotKey("4 516 943"))).toBeNull();
  });

  it("m4 — 2e lot : cadre sur lot B, jamais un repli zone/ville", () => {
    // Lot A d'abord (cadré), puis lot B : la décision pour B est le lot B lui-
    // même — surtout PAS une zone (ce qui déclencherait un dézoom vers la zone).
    const targetA = resolveSelectionCameraTarget(lotKey("A-1"), { fitLot: true });
    const targetB = resolveSelectionCameraTarget(lotKey("B-2"), { fitLot: true });
    expect(targetA).toEqual({ kind: "lot", citySlug: CITY, noLot: "A-1" });
    expect(targetB).toEqual({ kind: "lot", citySlug: CITY, noLot: "B-2" });
    // Garde anti-régression : sélectionner un lot ne renvoie JAMAIS une cible
    // zone (le chemin qui, lui, recadrerait/dézoomerait sur l'étendue parente).
    expect(targetB?.kind).not.toBe("zone");
  });

  it("clés non géo (signal / municipality) → aucun cadrage", () => {
    expect(resolveSelectionCameraTarget(makeKey("signal", "sig-1"), { fitLot: true })).toBeNull();
    expect(resolveSelectionCameraTarget(makeKey("municipality", CITY))).toBeNull();
  });

  it("id malformé (sans séparateur ville/ref) → aucun cadrage", () => {
    expect(resolveSelectionCameraTarget(makeKey("lot", "sansslash"), { fitLot: true })).toBeNull();
    expect(resolveSelectionCameraTarget(makeKey("zone", "sansslash"))).toBeNull();
  });
});
