import { describe, expect, it } from "vitest";
import { isPublicCanonicalUrl, publicAuditUrl } from "./geo-provenance.js";

/**
 * #2b — whitelist de preuve publique cliquable, garde SIGNATURE-based (contrat
 * mesuré recette WHITELIST_2B_PROOF_URL_CONTRACT, 2893 sourceUrl). Vecteurs
 * d'acceptation RÉELS du dump (anti-invention) : A* deviennent cliquables,
 * R* restent rejetés (routés viewer/rien).
 */
describe("isPublicCanonicalUrl — #2b garde signature-based", () => {
  it("A1 object-storage PUBLIC VPlus non signé → true (était false)", () => {
    expect(
      isPublicCanonicalUrl(
        "https://vplus-documents.s3.ca-central-1.amazonaws.com/batiscan/_publication/fichiers/PV%202025-05-05%20Projet%20final(1).pdf",
      ),
    ).toBe(true);
  });

  it("A2 site muni S3 public → true (était false)", () => {
    expect(
      isPublicCanonicalUrl(
        "https://saintamable-site.s3.ca-central-1.amazonaws.com/wp-content/uploads/2026/05/pv.pdf",
      ),
    ).toBe(true);
  });

  it("A3 URL muni avec FRAGMENT (sélection de doc) → true (était false)", () => {
    expect(
      isPublicCanonicalUrl(
        "https://clarendon.ca/wp-content/uploads/2025/07/Clarendon-minutes-2023-frn.zip#page/Proces-verbaux-14-novembre",
      ),
    ).toBe(true);
  });

  it("A3bis query bénigne (sélection de doc, pas de credential) → true", () => {
    expect(isPublicCanonicalUrl("https://ville.qc.ca/doc?id=42&section=pv")).toBe(true);
  });

  it("A4 URL canonique propre → true (inchangé)", () => {
    expect(
      isPublicCanonicalUrl("https://brigham.ca/wp-content/uploads/PV-2026-03-03.pdf"),
    ).toBe(true);
  });

  it("R1 archive interne s3:// → false (scheme non-http → routée viewer)", () => {
    expect(isPublicCanonicalUrl("s3://raw/alma/d0c3a558f525a.pdf")).toBe(false);
  });

  it("R2 URL S3 SIGNÉE → false (query de signature/credential)", () => {
    expect(
      isPublicCanonicalUrl(
        "https://vplus-documents.s3.ca-central-1.amazonaws.com/x/PV.pdf?X-Amz-Signature=abc&X-Amz-Credential=AKIA",
      ),
    ).toBe(false);
  });

  it("R2bis autres marqueurs signés (Signature/token/AWSAccessKeyId/Policy) → false", () => {
    expect(isPublicCanonicalUrl("https://host.ca/x.pdf?Signature=abc")).toBe(false);
    expect(isPublicCanonicalUrl("https://host.ca/x.pdf?token=secret")).toBe(false);
    expect(isPublicCanonicalUrl("https://host.ca/x.pdf?AWSAccessKeyId=AKIAxxx")).toBe(false);
    expect(isPublicCanonicalUrl("https://host.ca/x.pdf?Policy=eyJ")).toBe(false);
  });

  it("R3 credential user:pass@ → false", () => {
    expect(isPublicCanonicalUrl("https://user:pass@brigham.ca/PV.pdf")).toBe(false);
  });

  it("R4 host privé / loopback / RFC1918 → false (anti-SSRF, inchangé)", () => {
    expect(isPublicCanonicalUrl("http://127.0.0.1/PV.pdf")).toBe(false);
    expect(isPublicCanonicalUrl("https://10.0.0.5/PV.pdf")).toBe(false);
    expect(isPublicCanonicalUrl("http://minio.internal/PV.pdf")).toBe(false);
  });

  it("R5 scheme non-http (javascript:/data:) → false (inchangé)", () => {
    expect(isPublicCanonicalUrl("javascript:alert(1)")).toBe(false);
    expect(isPublicCanonicalUrl("data:text/html,x")).toBe(false);
  });

  it("publicAuditUrl : renvoie l'URL si canonique publique, null sinon", () => {
    expect(publicAuditUrl("https://brigham.ca/PV.pdf")).toBe("https://brigham.ca/PV.pdf");
    expect(publicAuditUrl("s3://raw/x.pdf")).toBeNull();
    expect(publicAuditUrl(null)).toBeNull();
  });
});
