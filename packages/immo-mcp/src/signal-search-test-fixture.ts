/** Synthetic normalized contract data shared by transport regression suites. */
export const SIGNAL_TEST_WORKSPACE = "12345678-1234-4234-9234-123456789abc";
export function signalSearchBody(city = "longueuil", signals: unknown[] = []) {
  return { ok: true, workspaceId: SIGNAL_TEST_WORKSPACE, citySlug: city, signals };
}
export function signalSearchItem(city = "longueuil", overrides: Record<string, unknown> = {}) {
  return { id: "sig-synthetique-1", city, type: "reglement", etape: "avis_motion",
    regulatoryStatus: "firm", etape_date: "2026-10-01", reglement_number: "R-1",
    zone_ref: "H-1", no_lot: null, summary: "Synthetic signal", source_document_id: "raw/synthetic.pdf",
    ...overrides };
}
