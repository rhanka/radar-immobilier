/**
 * Tests unitaires pour le panneau Preuve dans SignauxSelPanel.
 *
 * Pattern : test des helpers purs + extraction de l'evidence, sans rendu DOM
 * (pas de @testing-library/svelte). On valide la logique métier :
 *   1. Une citation unique extraite (pas de doublon)
 *   2. Le bouton "Voir la preuve" est activé quand une source documentaire existe
 *   3. Le bouton est désactivé quand aucune source documentaire n'est présente
 *   4. Le callback onOpenEvidence reçoit la bonne preuve (titre + evidence)
 */
import { describe, it, expect } from "vitest";
import {
  extractSignalEvidence,
  type GraphSignalNode,
  type SignalEvidence,
} from "$lib/signals/graph-signal-detail-client.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphSignalNode> = {}): GraphSignalNode {
  return {
    id: "sig-test-01",
    type: "Signal",
    label: "Avis de motion règlement 2026-15 (zone H-431)",
    citySlug: "saint-constant",
    sourceRef: null,
    createdAt: "2026-05-19T12:00:00.000Z",
    props: {},
    ...overrides,
  };
}

function makeNodeWithEvidence(params: {
  citation?: string;
  excerpt?: string;
  sourceUrl?: string;
  rawRef?: string;
  page?: number;
}): GraphSignalNode {
  return makeNode({
    props: {
      citation: params.citation ?? null,
      excerpt: params.excerpt ?? null,
      sourceUrl: params.sourceUrl ?? null,
      rawRef: params.rawRef ?? null,
      page: params.page ?? null,
    },
  });
}

// ── Helper miroir de SignauxSelPanel ──────────────────────────────────────────

function hasSourceEvidence(evidence: SignalEvidence): boolean {
  return (
    evidence.documentUrl !== null ||
    evidence.sourceUrl !== null ||
    evidence.rawRef !== null ||
    evidence.rawObjectKey !== null ||
    evidence.sourceRef !== null
  );
}

function evidenceText(value: string | null, maxLength = 260): string | null {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function sourceButtonLabel(evidence: SignalEvidence): string {
  if (evidence.documentUrl || evidence.sourceUrl) return "Voir la preuve";
  if (hasSourceEvidence(evidence)) return "Voir la preuve";
  return "Source manquante";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SignauxSelPanel — panneau Preuve (citation unique)", () => {
  it("extractSignalEvidence retourne une citation quand excerpt est présent dans props", () => {
    const node = makeNodeWithEvidence({ excerpt: "Le conseil municipal approuve..." });
    const evidence = extractSignalEvidence(node);
    expect(evidence.excerpt).toBe("Le conseil municipal approuve...");
    // La citation est disponible via excerpt OU citation — une seule valeur
    const displayText = evidenceText(evidence.excerpt ?? evidence.citation);
    expect(displayText).toBe("Le conseil municipal approuve...");
  });

  it("extractSignalEvidence : citation et excerpt pointent sur la même valeur (pas de doublon)", () => {
    const node = makeNodeWithEvidence({ citation: "Attendu que la zone H-431..." });
    const evidence = extractSignalEvidence(node);
    // On affiche UNE SEULE valeur : excerpt ?? citation
    const displayed = evidence.excerpt ?? evidence.citation;
    expect(displayed).toBeTruthy();
    // La citation apparaît au plus une fois dans la valeur affichée
    const occurrences = (displayed ?? "").split("Attendu que la zone H-431...").length - 1;
    expect(occurrences).toBe(1);
  });

  it("extractSignalEvidence : nodes sans citation → evidenceText retourne null", () => {
    const node = makeNode({ props: {} });
    const evidence = extractSignalEvidence(node);
    const displayText = evidenceText(evidence.excerpt ?? evidence.citation);
    expect(displayText).toBeNull();
  });
});

describe("SignauxSelPanel — bouton Voir la preuve", () => {
  it("hasSourceEvidence est true quand sourceUrl est présente", () => {
    const node = makeNodeWithEvidence({
      sourceUrl: "https://exemple.com/doc.pdf",
      page: 5,
    });
    const evidence = extractSignalEvidence(node);
    expect(hasSourceEvidence(evidence)).toBe(true);
  });

  it("hasSourceEvidence est true quand rawRef est présent", () => {
    const node = makeNodeWithEvidence({
      rawRef: "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
    });
    const evidence = extractSignalEvidence(node);
    expect(hasSourceEvidence(evidence)).toBe(true);
  });

  it("hasSourceEvidence est false quand aucune source documentaire", () => {
    const node = makeNode({ props: { description: "Changement de zonage" } });
    const evidence = extractSignalEvidence(node);
    expect(hasSourceEvidence(evidence)).toBe(false);
  });

  it("sourceButtonLabel retourne 'Voir la preuve' quand sourceUrl existe", () => {
    const node = makeNodeWithEvidence({ sourceUrl: "https://exemple.com/doc.pdf" });
    const evidence = extractSignalEvidence(node);
    expect(sourceButtonLabel(evidence)).toBe("Voir la preuve");
  });

  it("sourceButtonLabel retourne 'Source manquante' quand aucune source", () => {
    const node = makeNode({ props: {} });
    const evidence = extractSignalEvidence(node);
    expect(sourceButtonLabel(evidence)).toBe("Source manquante");
  });
});

describe("SignauxSelPanel — onOpenEvidence callback payload", () => {
  it("openEvidence construit le payload correct (titre + evidence)", () => {
    const node = makeNodeWithEvidence({
      sourceUrl: "https://exemple.com/pv-2026-05.pdf",
      excerpt: "Résolution 2026-15 adoptée à l'unanimité",
      page: 12,
    });
    const evidence = extractSignalEvidence(node);

    // Simule le payload passé à onOpenEvidence
    const payload = { title: node.label, evidence };

    expect(payload.title).toBe("Avis de motion règlement 2026-15 (zone H-431)");
    expect(payload.evidence.sourceUrl).toBe("https://exemple.com/pv-2026-05.pdf");
    expect(payload.evidence.excerpt).toBe("Résolution 2026-15 adoptée à l'unanimité");
    expect(payload.evidence.page).toBe(12);
  });

  it("onOpenEvidence est appelé avec les bonnes données (simulation callback)", () => {
    let capturedPayload: { title: string; evidence: SignalEvidence } | null = null;

    function simulateOpenEvidence(node: GraphSignalNode): void {
      const evidence = extractSignalEvidence(node);
      capturedPayload = { title: node.label, evidence };
    }

    const node = makeNodeWithEvidence({
      rawRef: "raw/saint-constant/2026/05/pv.txt",
      citation: "Le règlement 2026-15 est adopté",
    });

    simulateOpenEvidence(node);

    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload!.title).toBe(node.label);
    expect(capturedPayload!.evidence.rawRef).toContain("saint-constant");
    expect(capturedPayload!.evidence.citation).toBe("Le règlement 2026-15 est adopté");
  });
});

describe("SignauxSelPanel — texte tronqué", () => {
  it("evidenceText tronque les citations longues après 260 caractères", () => {
    const longCitation = "a".repeat(300);
    const truncated = evidenceText(longCitation);
    expect(truncated).not.toBeNull();
    expect(truncated!.length).toBeLessThanOrEqual(264); // 260 + "…" + marge
    expect(truncated!.endsWith("…")).toBe(true);
  });

  it("evidenceText retourne la valeur complète si ≤ 260 caractères", () => {
    const shortCitation = "Citation courte.";
    expect(evidenceText(shortCitation)).toBe("Citation courte.");
  });
});
