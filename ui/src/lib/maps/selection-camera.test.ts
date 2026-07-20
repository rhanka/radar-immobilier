/**
 * m4 — Décision de commande caméra à la sélection.
 *
 * Contrat « lot suivant » (PO : « recentrer sur le lot MAIS garder le zoom ») :
 *  - premier lot → cadrage existant (frame, fitBounds permis) ;
 *  - reclic sur le MÊME lot → AUCUNE commande caméra ;
 *  - autre lot, MÊME zone (ou indéterminée) → recentrage zoom conservé ;
 *  - lot d'une AUTRE zone / autre ville → cadrage existant permis (frame).
 */
import { describe, it, expect } from "vitest";
import { makeKey } from "./selection-bucket.js";
import {
  resolveSelectionCameraTarget,
  type PreviousCameraLot,
} from "./selection-camera.js";

const CITY = "delson";
const lotKey = (noLot: string, city = CITY) => makeKey("lot", `${city}/${noLot}`);
const zoneKey = (code: string) => makeKey("zone", `${CITY}/${code}`);
const prevLot = (noLot: string, zoneCode: string | null, city = CITY): PreviousCameraLot => ({
  citySlug: city,
  noLot,
  zoneCode,
});

describe("resolveSelectionCameraTarget — cadrage cohérent zone/lot", () => {
  it("zone → cadrée sur son étendue (sans option)", () => {
    expect(resolveSelectionCameraTarget(zoneKey("VP-101"))).toEqual({
      kind: "zone",
      citySlug: CITY,
      code: "VP-101",
    });
  });

  it("premier lot + fitLot → cadrage existant (frame)", () => {
    expect(resolveSelectionCameraTarget(lotKey("4 516 943"), { fitLot: true })).toEqual({
      kind: "lot",
      citySlug: CITY,
      noLot: "4 516 943",
      mode: "frame",
    });
  });

  it("lot sans fitLot → aucun cadrage (auto-sélection du 1er lot d'une ville)", () => {
    expect(resolveSelectionCameraTarget(lotKey("4 516 943"))).toBeNull();
  });

  it("reclic sur le MÊME lot → aucune commande caméra", () => {
    expect(
      resolveSelectionCameraTarget(lotKey("A-1"), {
        fitLot: true,
        previousLot: prevLot("A-1", "VP-101"),
      }),
    ).toBeNull();
  });

  it("autre lot, MÊME zone → recentrage (zoom conservé, jamais fitBounds)", () => {
    expect(
      resolveSelectionCameraTarget(lotKey("C-3"), {
        fitLot: true,
        previousLot: prevLot("A-1", "VP-101"),
        zoneCodeForLot: () => "VP-101",
      }),
    ).toEqual({ kind: "lot", citySlug: CITY, noLot: "C-3", mode: "recenter" });
  });

  it("autre lot, zone INDÉTERMINÉE → recentrage (défaut : ne jamais surprendre le zoom)", () => {
    // Zone du lot précédent inconnue…
    expect(
      resolveSelectionCameraTarget(lotKey("C-3"), {
        fitLot: true,
        previousLot: prevLot("A-1", null),
        zoneCodeForLot: () => "VP-101",
      }),
    ).toMatchObject({ mode: "recenter" });
    // …ou zone du lot cliqué irrésoluble (pas de resolver / hors zones).
    expect(
      resolveSelectionCameraTarget(lotKey("C-3"), {
        fitLot: true,
        previousLot: prevLot("A-1", "VP-101"),
      }),
    ).toMatchObject({ mode: "recenter" });
    expect(
      resolveSelectionCameraTarget(lotKey("C-3"), {
        fitLot: true,
        previousLot: prevLot("A-1", "VP-101"),
        zoneCodeForLot: () => null,
      }),
    ).toMatchObject({ mode: "recenter" });
  });

  it("lot d'une AUTRE zone → cadrage existant permis (frame, zoom libre)", () => {
    expect(
      resolveSelectionCameraTarget(lotKey("B-2"), {
        fitLot: true,
        previousLot: prevLot("A-1", "VP-101"),
        zoneCodeForLot: () => "VP-102",
      }),
    ).toEqual({ kind: "lot", citySlug: CITY, noLot: "B-2", mode: "frame" });
  });

  it("lot d'une AUTRE ville → cadrage existant permis (frame)", () => {
    expect(
      resolveSelectionCameraTarget(lotKey("B-2", "candiac"), {
        fitLot: true,
        previousLot: prevLot("A-1", "VP-101", CITY),
        zoneCodeForLot: () => "VP-101",
      }),
    ).toEqual({ kind: "lot", citySlug: "candiac", noLot: "B-2", mode: "frame" });
  });

  it("m4 — 2e lot : cible le lot lui-même, jamais un repli zone/ville", () => {
    const targetB = resolveSelectionCameraTarget(lotKey("B-2"), {
      fitLot: true,
      previousLot: prevLot("A-1", "VP-101"),
      zoneCodeForLot: () => "VP-101",
    });
    expect(targetB).toMatchObject({ kind: "lot", citySlug: CITY, noLot: "B-2" });
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
