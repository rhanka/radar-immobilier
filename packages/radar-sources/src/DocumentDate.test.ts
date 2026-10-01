import { describe, expect, it } from "vitest";
import { DocumentDateSchema, extractDocumentHeaderDate, resolveDocumentDate } from "./DocumentDate.js";

describe("documentary dates", () => {
  it.each([
    ["MARDI LE 28 JUILLET 2026\nCONSEIL MUNICIPAL – SÉANCE ORDINAIRE", "2026-07-28"],
    ["Procès-verbal d'une séance ordinaire du Conseil municipal\ntenu e le 28 juillet 2026, à 19 h", "2026-07-28"],
    ["MARDI LE 29 septembre 2026\nCONSEIL MUNICIPAL – SÉANCE ORDINAIRE", "2026-09-29"],
  ])("should read the session header without relying on its filename", (text, value) => {
    expect(extractDocumentHeaderDate(text)).toMatchObject({ status: "known", value,
      precision: "day", kind: "session", method: "header", evidence: { page: 1 } });
  });
  it("should preserve missing, invalid and conflicting dates explicitly", () => {
    expect(extractDocumentHeaderDate("Conseil municipal séance du 31 février 2026").status).toBe("unknown");
    expect(extractDocumentHeaderDate("Conseil municipal séances du 28 juillet 2026 et du 29 juillet 2026")
      .status).toBe("ambiguous");
    expect(extractDocumentHeaderDate("Avis de taxes payé le 29 septembre 2026").status).toBe("unknown");
    expect(extractDocumentHeaderDate("Conseil municipal\fSéance du 29 septembre 2026").status).toBe("unknown");
  });
  it("should not read historical dates in agenda items", () => {
    expect(extractDocumentHeaderDate("Conseil municipal\nI. ORDRE DU JOUR\nSéance du 28 juillet 2026")
      .status).toBe("unknown");
  });
  it("should preserve month precision and flag contradictory persisted dates", () => {
    const date = resolveDocumentDate({ publishedAt: "2026-09" });
    expect(date).toMatchObject({ status: "known", precision: "month", value: "2026-09" });
    expect(DocumentDateSchema.safeParse({ ...date, precision: "day" }).success).toBe(false);
    const known = resolveDocumentDate({ publishedAt: "2026-07-28" });
    expect(resolveDocumentDate({ documentDate: known, publishedAt: "2026-09-29" }).status).toBe("ambiguous");
  });
});
