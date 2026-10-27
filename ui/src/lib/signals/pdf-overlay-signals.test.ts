import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  buildNavSignals,
  buildOverlaySignals,
  buildHoverCard,
  distinctDocCount,
  docIdentityOf,
  rebuildSignalEvidence,
  type OpenSignalEvidence,
} from "./pdf-overlay-signals.js";
import { extractSignalEvidence } from "./graph-signal-detail-client.js";
import { signalColorAt } from "./pdf-signal-colors.js";

/**
 * Couvre la projection NAV (#91) + hover-card (#4) + le marquage in/out-filtre
 * (#4) du surlignage. Pures fonctions : aucune dépendance navigateur.
 */

function node(
  overrides: Partial<GraphSignalNode> & { props?: Record<string, unknown> },
): GraphSignalNode {
  return {
    id: "n",
    type: "Signal",
    label: "Sig",
    citySlug: "delson",
    sourceRef: null,
    createdAt: null,
    props: {},
    ...overrides,
  };
}

/** Signal porté par un PV (rawRef) sur une page donnée, avec extrait. */
function pvSignal(
  id: string,
  rawRef: string,
  page: number,
  extra: Record<string, unknown> = {},
): GraphSignalNode {
  return node({
    id,
    label: id,
    props: { rawRef, page, excerpt: `extrait ${id}`, ...extra },
  });
}

describe("docIdentityOf", () => {
  it("préfère rawRef, puis les autres ancres", () => {
    const ev = extractSignalEvidence(pvSignal("A", "raw/x/pv-a.pdf", 2));
    expect(docIdentityOf(ev)).toBe("raw/x/pv-a.pdf");
  });

  it("retombe sur sourceUrl quand rawRef absent", () => {
    const ev = extractSignalEvidence(
      node({ props: { sourceUrl: "https://ville.ca/pv.pdf" } }),
    );
    expect(docIdentityOf(ev)).toContain("ville.ca");
  });
});

describe("buildNavSignals", () => {
  it("projette la liste filtrée en navSignals avec couleurs par rang", () => {
    const filtered = [
      pvSignal("A", "raw/x/pv-a.pdf", 2),
      pvSignal("B", "raw/x/pv-a.pdf", 5),
      pvSignal("C", "raw/y/pv-b.pdf", 1),
    ];
    const nav = buildNavSignals(filtered);
    expect(nav.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(nav.map((n) => n.color)).toEqual([
      signalColorAt(0),
      signalColorAt(1),
      signalColorAt(2),
    ]);
    // Tous dans-filtre (navSignals = liste filtrée).
    expect(nav.every((n) => n.inFilter)).toBe(true);
    // docId regroupe A+B (même PV) vs C (autre PV).
    expect(nav[0]!.docId).toBe(nav[1]!.docId);
    expect(nav[2]!.docId).not.toBe(nav[0]!.docId);
    // pages portées.
    expect(nav.map((n) => n.page)).toEqual([2, 5, 1]);
  });

  it("compte les documents distincts pour l'indicateur PDF i/N", () => {
    const nav = buildNavSignals([
      pvSignal("A", "raw/x/pv-a.pdf", 1),
      pvSignal("B", "raw/x/pv-a.pdf", 2),
      pvSignal("C", "raw/y/pv-b.pdf", 1),
    ]);
    expect(distinctDocCount(nav)).toBe(2);
  });

  it("un seul doc ⇒ distinctDocCount = 1 (PDF i/N masqué)", () => {
    const nav = buildNavSignals([
      pvSignal("A", "raw/x/pv-a.pdf", 1),
      pvSignal("B", "raw/x/pv-a.pdf", 2),
    ]);
    expect(distinctDocCount(nav)).toBe(1);
  });
});

describe("buildOverlaySignals — marquage in/out-filtre (#4)", () => {
  const current = pvSignal("A", "raw/x/pv.pdf", 2, { category: "rezonage" });
  const inF = pvSignal("B", "raw/x/pv.pdf", 2, { category: "rezonage" });
  const outF = pvSignal("C", "raw/x/pv.pdf", 2, { category: "vente" });

  it("marque hors-filtre les co-PV qui échouent le prédicat", () => {
    const sigs = buildOverlaySignals(
      current,
      [current, inF, outF],
      "raw/x/pv.pdf",
      (n) => (n.props.category as string) === "rezonage",
    );
    const byId = Object.fromEntries(sigs.map((s) => [s.id, s]));
    expect(byId.A!.inFilter).toBe(true); // courant toujours dans-filtre
    expect(byId.A!.current).toBe(true);
    expect(byId.B!.inFilter).toBe(true);
    expect(byId.C!.inFilter).toBe(false); // catégorie "vente" hors-filtre
  });

  it("sans prédicat, tous dans-filtre (rétrocompat LOT 1/2)", () => {
    const sigs = buildOverlaySignals(current, [current, outF], "raw/x/pv.pdf");
    expect(sigs.every((s) => s.inFilter)).toBe(true);
  });
});

describe("buildHoverCard (#4)", () => {
  it("projette titre, type, règlement, zone, page, citation + chips", () => {
    const n = node({
      id: "Z1",
      label: "Z1 rezonage",
      type: "DesignationEvent",
      props: {
        rawRef: "raw/x/pv.pdf",
        page: 4,
        excerpt: "le conseil adopte le rezonage Z1",
        reglement_number: "2024-12",
        zone_ref: "H-204",
      },
    });
    const card = buildHoverCard(n, "#3b82f6");
    expect(card.title).toBe("Z1 rezonage");
    expect(card.typeLabel).toBe("Événement de désignation");
    expect(card.color).toBe("#3b82f6");
    expect(card.reglement).toBe("2024-12");
    expect(card.zoneRef).toBe("H-204");
    expect(card.page).toBe(4);
    expect(card.citation).toContain("rezonage Z1");
    expect(card.completeness).toHaveLength(5);
    expect(card.completeness.find((c) => c.label === "Page")?.ok).toBe(true);
  });

  it("tronque les citations longues à 260 caractères", () => {
    const long = "x".repeat(400);
    const card = buildHoverCard(
      node({ props: { rawRef: "raw/x.pdf", page: 1, excerpt: long } }),
      "#000000",
    );
    expect(card.citation?.length).toBe(261); // 260 + ellipse
    expect(card.citation?.endsWith("…")).toBe(true);
  });
});

describe("rebuildSignalEvidence (6D secondary parity)", () => {
  const RAW = "raw/6d/pv.pdf";
  const visible = (ids: string[]): Set<string> => new Set(ids);
  const inFilter =
    (ids: string[]) =>
    (n: GraphSignalNode): boolean =>
      ids.includes(n.id);

  function opened(
    currentId: string,
    nodes: GraphSignalNode[],
    filterIds: string[],
  ): OpenSignalEvidence {
    const current = nodes.find((n) => n.id === currentId);
    if (!current) throw new Error(`missing fixture node ${currentId}`);
    const evidence = extractSignalEvidence(current);
    return {
      title: current.label,
      evidence,
      signals: buildOverlaySignals(current, nodes, evidence.rawRef, inFilter(filterIds)),
      nodeId: current.id,
    };
  }

  it("drops an archived co-document signal from the rebuilt highlights", () => {
    const active = opened("A", [pvSignal("A", RAW, 1), pvSignal("B", RAW, 3)], ["A", "B"]);
    expect(active.signals.map((s) => s.id)).toEqual(["A", "B"]);
    // B archived server-side: the refreshed authorized population omits it.
    const rebuilt = rebuildSignalEvidence(active, [pvSignal("A", RAW, 1)], inFilter(["A"]), visible(["A"]));
    expect(rebuilt?.nodeId).toBe("A");
    expect(rebuilt?.signals.map((s) => s.id)).toEqual(["A"]);
  });

  it("closes when the opened target itself is archived", () => {
    const active = opened("B", [pvSignal("A", RAW, 1), pvSignal("B", RAW, 3)], ["A", "B"]);
    const rebuilt = rebuildSignalEvidence(active, [pvSignal("A", RAW, 1)], inFilter(["A"]), visible(["A"]));
    expect(rebuilt).toBeNull();
  });

  it("closes when the target leaves the visible set while still authorized", () => {
    const nodes = [pvSignal("A", RAW, 1), pvSignal("B", RAW, 3)];
    const active = opened("B", nodes, ["A", "B"]);
    expect(rebuildSignalEvidence(active, nodes, inFilter(["A"]), visible(["A"]))).toBeNull();
  });

  it("replaces stale evidence when citation, page or rawRef change", () => {
    const active = opened("A", [pvSignal("A", RAW, 1)], ["A"]);
    const changed = pvSignal("A", "raw/6d/pv-v2.pdf", 4, { excerpt: "new excerpt" });
    changed.label = "Updated title";
    const rebuilt = rebuildSignalEvidence(active, [changed], inFilter(["A"]), visible(["A"]));
    expect(rebuilt?.title).toBe("Updated title");
    expect(rebuilt?.evidence.rawRef).toBe("raw/6d/pv-v2.pdf");
    expect(rebuilt?.evidence.page).toBe(4);
    expect(rebuilt?.evidence.excerpt).toBe("new excerpt");
    expect(rebuilt?.signals).toHaveLength(1);
  });

  it("reports an unknown target explicitly instead of an empty shell", () => {
    const active = opened("A", [pvSignal("A", RAW, 1)], ["A"]);
    const ghost: OpenSignalEvidence = { ...active, nodeId: "ghost" };
    const rebuilt = rebuildSignalEvidence(ghost, [pvSignal("A", RAW, 1)], inFilter(["A"]), visible(["A", "ghost"]));
    expect(rebuilt).toBeNull();
  });

  it("keeps ids, order and counts identical with no archives", () => {
    const nodes = [pvSignal("A", RAW, 1), pvSignal("B", RAW, 3), pvSignal("C", "raw/6d/other.pdf", 1)];
    const active = opened("A", nodes, ["A", "B", "C"]);
    const rebuilt = rebuildSignalEvidence(active, nodes, inFilter(["A", "B", "C"]), visible(["A", "B", "C"]));
    expect(rebuilt?.signals.map((s) => s.id)).toEqual(active.signals.map((s) => s.id));
    expect(rebuilt?.signals).toHaveLength(active.signals.length);
    expect(rebuilt?.signals).toEqual(active.signals);
    expect(rebuilt?.evidence).toEqual(active.evidence);
    expect(rebuilt?.title).toBe(active.title);
  });

  it("keeps authorized co-document signals outside the active filters", () => {
    const nodes = [pvSignal("A", RAW, 1), pvSignal("B", RAW, 3)];
    const active = opened("A", nodes, ["A", "B"]);
    const rebuilt = rebuildSignalEvidence(active, nodes, inFilter(["A"]), visible(["A"]));
    expect(rebuilt?.signals.map((signal) => [signal.id, signal.inFilter])).toEqual([
      ["A", true], ["B", false],
    ]);
  });
});
