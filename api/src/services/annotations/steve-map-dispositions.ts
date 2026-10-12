/** Source-category preparation only; no notes, marks, listings or zonage writes. */
const markProposals = {
  favori: { dimension: "pipeline", statut: "favori" },
  sollicite: { dimension: "pipeline", statut: "sollicite" },
  lettre: { dimension: "pipeline", statut: "lettre_envoyee" },
  envente: { dimension: "marche", statut: "en_vente" },
} as const;

/** Every category has an explicit destination and unresolved prerequisites. */
export function planSteveMapCategory(kind: string, sourceValue?: string) {
  switch (kind) {
    case "lot-note": return { representation: "canonical-discussion", requires: ["qualified-lot-or-historical-source", "documentary-attribution"] };
    case "manual-pin": return { representation: "position-resource-and-canonical-annotation",
      requires: ["coordinates-crs-units-precision", "qualified-semantic-profile", "documentary-attribution"] };
    case "zone": return { representation: "authoritative-zonage-resource",
      requires: ["authoritative-zone-match", "explicit-version-link", "canonical-comments-for-source-text"] };
    case "listing": return { representation: "business-source-resource",
      requires: ["qualified-listing-domain-mapping", "complete-price-url-fields", "documentary-attribution"] };
    case "mark": {
      const proposal = Object.hasOwn(markProposals, sourceValue ?? "")
        ? markProposals[sourceValue as keyof typeof markProposals] : null;
      return { representation: "business-prospect-state", proposal,
        requires: proposal ? ["documentary-attribution", "authorized-business-projection"] : ["source-meaning-and-business-equivalence"] };
    }
    default: return { representation: "unresolved-source-category", requires: ["explicit-category-inventory-and-disposition"] };
  }
}
