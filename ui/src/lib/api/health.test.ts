import { describe, expect, it } from "vitest";
import { mapHealthPayload, resolveHealthUrl } from "./health";

describe("mapHealthPayload", () => {
  it("maps a healthy API payload to an ok UI state", () => {
    expect(
      mapHealthPayload({
        status: "ok",
        db: { ok: true },
        objectStore: { ok: true },
      }),
    ).toEqual({
      kind: "ok",
      label: "API connectee",
      detail: "Postgres et stockage objet OK",
    });
  });

  it("maps a degraded API payload to a degraded UI state", () => {
    expect(
      mapHealthPayload({
        status: "degraded",
        db: { ok: false, detail: "connection refused" },
        objectStore: { ok: true },
      }),
    ).toEqual({
      kind: "degraded",
      label: "API degradee",
      detail: "connection refused",
    });
  });

  it("uses a same-origin health URL when no API base URL is configured", () => {
    expect(resolveHealthUrl()).toBe("/health");
  });
});
