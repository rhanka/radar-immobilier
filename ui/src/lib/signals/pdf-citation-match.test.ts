/**
 * Tests du matcher citation → couche texte PDF (logique pure, offline).
 *
 * Objectif produit : surligner le passage cité (« extrait cité ») même quand la
 * bbox est absente, en retrouvant la citation verbatim dans le texte de la page,
 * robuste aux espaces, accents, ligatures et coupures pdftotext.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  findCitationInPage,
  findTextOccurrenceInPage,
  itemsOverlappingRanges,
} from "./pdf-citation-match.js";

describe("normalizeForMatch", () => {
  it("met en minuscules, retire les accents et réduit les espaces", () => {
    expect(normalizeForMatch("  Le  Conseil   APPROUVE  ")).toBe("le conseil approuve");
    expect(normalizeForMatch("règlement numéro 2026-15")).toBe("reglement numero 2026-15");
  });

  it("décompose les ligatures œ/æ", () => {
    expect(normalizeForMatch("nœud cœur")).toBe("noeud coeur");
    expect(normalizeForMatch("et cætera")).toBe("et caetera");
  });

  it("normalise apostrophes et tirets typographiques", () => {
    expect(normalizeForMatch("l’unanimité")).toBe("l'unanimite");
    expect(normalizeForMatch("zone H‑431")).toBe("zone h-431");
  });
});

describe("findCitationInPage — match exact", () => {
  it("retrouve une citation présente verbatim et restitue l'intervalle brut", () => {
    const pageText =
      "Procès-verbal de la séance. Le conseil municipal approuve le règlement 2026-15. Fin.";
    const match = findCitationInPage(pageText, "Le conseil municipal approuve le règlement 2026-15");
    expect(match).not.toBeNull();
    expect(match!.coverage).toBe(1);
    const slice = pageText.slice(match!.start, match!.end);
    expect(slice.toLowerCase()).toContain("le conseil municipal approuve");
  });

  it("matche malgré les différences d'accents et d'espaces", () => {
    const pageText = "Attendu que la zone H-431 doit être modifiée selon les normes.";
    const match = findCitationInPage(pageText, "attendu  que  la  zone h-431 doit etre modifiee");
    expect(match).not.toBeNull();
    expect(match!.coverage).toBeGreaterThan(0.6);
  });

  it("matche une citation avec ligature face à un texte décomposé", () => {
    const pageText = "Le nœud du problème concerne le cœur du règlement.";
    const match = findCitationInPage(pageText, "le noeud du probleme concerne le coeur");
    expect(match).not.toBeNull();
  });
});

describe("findTextOccurrenceInPage — recherche plein-texte", () => {
  it("localise une occurrence courte normalisée et sélectionne la suivante", () => {
    const pageText = "Terme initial, puis TÉRME final";
    const match = findTextOccurrenceInPage(pageText, "terme", 1);
    expect(match).not.toBeNull();
    expect(pageText.slice(match!.start, match!.end)).toBe("TÉRME");
  });
});

describe("findCitationInPage — fallback fenêtre de mots", () => {
  it("retrouve la plus longue séquence quand la citation a une tête/queue bruitée", () => {
    const pageText =
      "Le conseil adopte la résolution 2026-15 portant sur la densification résidentielle.";
    // La citation graphify ajoute du bruit en tête et en queue absent du PV.
    const match = findCitationInPage(
      pageText,
      "[bruit ocr] adopte la résolution 2026-15 portant sur la densification [suite manquante]",
    );
    expect(match).not.toBeNull();
    const slice = normalizeForMatch(pageText.slice(match!.start, match!.end));
    expect(slice).toContain("resolution 2026-15");
    expect(match!.coverage).toBeLessThan(1);
    expect(match!.coverage).toBeGreaterThan(0);
  });

  it("ne matche PAS sur une simple fenêtre de mots génériques (bug #83)", () => {
    // « attendu que la municipalite » est une amorce générique présente sur
    // PLUSIEURS pages d'un PV. Avec l'ancien `||` (windowLen >= 4 suffisait),
    // ces 4 mots déclenchaient un surlignage parasite hors page cible. La
    // citation réelle (suite) étant absente de cette page, on attend `null`.
    const pageText =
      "Attendu que la municipalité de Saint-Damase tient une séance ordinaire ce jour.";
    const match = findCitationInPage(
      pageText,
      "attendu que la municipalité adopte le règlement 2026-42 sur la densification résidentielle du secteur nord",
    );
    expect(match).toBeNull();
  });

  it("retourne null quand la citation n'apparaît pas du tout", () => {
    const pageText = "Texte sans rapport avec la citation recherchée ici.";
    const match = findCitationInPage(pageText, "le conseil municipal approuve le règlement 2026-15");
    expect(match).toBeNull();
  });

  it("retourne null pour une citation vide", () => {
    expect(findCitationInPage("du texte", "")).toBeNull();
    expect(findCitationInPage("du texte", "   ")).toBeNull();
  });

  it("retourne null pour un texte de page vide", () => {
    expect(findCitationInPage("", "une citation")).toBeNull();
  });
});

/**
 * Modes d'échec MESURÉS sur PV réels (Saint-Amable : 6/15 citations retrouvées
 * par l'ancien algorithme, 15/15 par celui-ci). La couche texte pdf.js découpe
 * la page en items arbitraires que le viewer joint par des espaces : le texte
 * de page contient des espaces ARTIFICIELS au milieu des nombres et des mots.
 */
describe("findCitationInPage — tokenisation pdf.js (espaces artificiels)", () => {
  it("matche un numéro de règlement éclaté en items (« 712 - 46 - 2026 »)", () => {
    // Reproduit la concat réelle du viewer : items ["712", "-", "46", …] + " ".
    const pageText =
      "Avis de motion est donné par le conseiller à l'effet que sera présenté pour adoption " +
      "le Règlement numéro 712 - 46 - 2026 modifiant le règlement de zonage 712 - 00 - 2013 .";
    const match = findCitationInPage(
      pageText,
      "sera présenté pour adoption le Règlement numéro 712-46-2026 modifiant le règlement de zonage 712-00-2013",
    );
    expect(match).not.toBeNull();
    expect(match!.coverage).toBe(1);
  });

  it("matche un mot coupé en plein milieu par un item (« qu e la demande »)", () => {
    // Vu sur PV réel : « CONSIDÉRANT qu e la demande » (item scindé après « qu »).
    const pageText =
      "CONSIDÉRANT qu e la demande de dérogation mineure vise à autoriser l'aménagement de trois cases.";
    const match = findCitationInPage(
      pageText,
      "considérant que la demande de dérogation mineure vise à autoriser l'aménagement",
    );
    expect(match).not.toBeNull();
    expect(match!.coverage).toBe(1);
  });

  it("matche malgré une césure de fin de ligne (« modifica- tion »)", () => {
    const pageText =
      "Le conseil approuve la modifica- tion du plan de zonage pour le secteur des Érables au nord.";
    const match = findCitationInPage(
      pageText,
      "le conseil approuve la modification du plan de zonage pour le secteur",
    );
    expect(match).not.toBeNull();
  });
});

describe("findCitationInPage — citations à élisions (plusieurs passages disjoints)", () => {
  it("surligne les DEUX passages autour d'un marqueur « […] »", () => {
    const pageText =
      "052-03-26 DEMANDE DE DÉROGATION MINEURE – 2026-001-DM – 153 RUE DIANA " +
      "CONSIDÉRANT que la demande a été déposée pour le lot au cadastre du Québec " +
      "CONSIDÉRANT l'avis favorable du comité consultatif d'urbanisme en séance " +
      "D'ACCEPTER la demande de dérogation mineure numéro 2026-001-DM telle que proposée.";
    const match = findCitationInPage(
      pageText,
      "052-03-26 DEMANDE DE DÉROGATION MINEURE – 2026-001-DM – 153 RUE DIANA […] " +
        "D'ACCEPTER la demande de dérogation mineure numéro 2026-001-DM telle que proposée.",
    );
    expect(match).not.toBeNull();
    expect(match!.ranges.length).toBe(2);
    expect(match!.coverage).toBeGreaterThan(0.9);
    // Les plages sont ordonnées et disjointes : en-tête d'abord, décision ensuite.
    const [head, decision] = match!.ranges;
    expect(head!.end).toBeLessThanOrEqual(decision!.start);
    expect(normalizeForMatch(pageText.slice(head!.start, head!.end))).toContain("rue diana");
    expect(normalizeForMatch(pageText.slice(decision!.start, decision!.end))).toContain(
      "d'accepter la demande",
    );
  });

  it("retrouve les passages disjoints MÊME SANS marqueur d'élision", () => {
    // Cas réel : la citation graphify concatène en-tête + décision sans « […] ».
    const pageText =
      "051-03-26 DEMANDE DE DÉROGATION MINEURE – 2026-001-DM – 153 RUE DIANA " +
      "CONSIDÉRANT que la demande a été déposée pour le lot du cadastre officiel " +
      "D'ACCEPTER la demande de dérogation mineure numéro 2026-001-DM telle que proposée.";
    const match = findCitationInPage(
      pageText,
      "051-03-26 DEMANDE DE DÉROGATION MINEURE – 2026-001-DM – 153 RUE DIANA " +
        "D'ACCEPTER la demande de dérogation mineure numéro 2026-001-DM telle que proposée.",
    );
    expect(match).not.toBeNull();
    expect(match!.ranges.length).toBe(2);
    expect(match!.coverage).toBeGreaterThan(0.9);
  });
});

describe("findCitationInPage — garde anti-boilerplate (identifiants)", () => {
  it("rejette un match fait UNIQUEMENT de formules partagées entre règlements", () => {
    // Cas mesuré sur PV réel : la page porte le règlement 712-46-2026 (zone
    // TR-185) ; la citation vise le règlement 712-47-2026 (zone H-59). Les
    // formules communes (« modifiant le règlement de zonage 712-00-2013 afin de
    // modifier les limites de la zone », « avis de motion et adoption du premier
    // projet ») accumulent > 40 % de couverture, mais les identifiants propres
    // (712-47-2026, H-59, RX-122) ne sont PAS sur la page → rejet.
    const pageText =
      "060-03-26 RÈGLEMENT NUMÉRO 712 - 46 - 2026 MODIFIANT LE RÈGLEMENT DE ZONAGE " +
      "712 - 00 - 2013 AFIN DE MODIFIER LES LIMITES DE LA ZONE TR - 185 AU PROFIT DE LA " +
      "ZONE CEN - 183 – AVIS DE MOTION ET ADOPTION DU PREMIER PROJET .";
    const match = findCitationInPage(
      pageText,
      "097-04-26 RÈGLEMENT NUMÉRO 712-47-2026 MODIFIANT LE RÈGLEMENT DE ZONAGE " +
        "712-00-2013 AFIN DE MODIFIER LES LIMITES DE LA ZONE H-59 ET DE SUPPRIMER LA " +
        "ZONE RX-122 – AVIS DE MOTION ET ADOPTION DU PREMIER PROJET",
    );
    expect(match).toBeNull();
  });

  it("accepte quand les identifiants propres SONT couverts par le match", () => {
    const pageText =
      "097-04-26 RÈGLEMENT NUMÉRO 712 - 47 - 2026 MODIFIANT LE RÈGLEMENT DE ZONAGE " +
      "712 - 00 - 2013 AFIN DE MODIFIER LES LIMITES DE LA ZONE H - 59 ET DE SUPPRIMER " +
      "LA ZONE RX - 122 – AVIS DE MOTION ET ADOPTION DU PREMIER PROJET .";
    const match = findCitationInPage(
      pageText,
      "097-04-26 RÈGLEMENT NUMÉRO 712-47-2026 MODIFIANT LE RÈGLEMENT DE ZONAGE " +
        "712-00-2013 AFIN DE MODIFIER LES LIMITES DE LA ZONE H-59 ET DE SUPPRIMER LA " +
        "ZONE RX-122 – AVIS DE MOTION ET ADOPTION DU PREMIER PROJET",
    );
    expect(match).not.toBeNull();
    expect(match!.coverage).toBe(1);
  });
});

describe("findCitationInPage — préfixe long véridique (fenêtre forte)", () => {
  it("accepte un préfixe de ≥ 10 mots même si la couverture globale est < 40 %", () => {
    // Citation longue dont seule la tête est sur la page (le reste a divergé) :
    // un match contigu de 12 mots est quasi impossible par hasard → accepté.
    const pageText =
      "Avis de motion est donné par le conseiller Sylvain Bénard à l'effet que sera présenté un règlement.";
    const excerpt =
      "Avis de motion est donné par le conseiller Sylvain Bénard à l'effet " +
      "que soit modifié le périmètre urbain du secteur nord selon les dispositions prévues " +
      "aux annexes cartographiques du schéma d'aménagement révisé de l'agglomération métropolitaine";
    const match = findCitationInPage(pageText, excerpt);
    expect(match).not.toBeNull();
    expect(match!.coverage).toBeLessThan(0.6);
    const slice = normalizeForMatch(pageText.slice(match!.start, match!.end));
    expect(slice).toContain("avis de motion");
  });
});

describe("itemsOverlappingRanges — géométrie du surlignage (couche texte simulée)", () => {
  // Couche texte simulée : 6 items « multi-lignes » avec leurs intervalles dans
  // le texte de page concaténé (le viewer dessine UNE marque par item retourné).
  const items = [
    { start: 0, end: 20 }, // ligne 1
    { start: 21, end: 45 }, // ligne 1 (suite)
    { start: 46, end: 80 }, // ligne 2
    { start: 81, end: 120 }, // ligne 3
    { start: 121, end: 150 }, // ligne 4
    { start: 151, end: 190 }, // ligne 5
  ];

  it("localise les items d'une plage multi-lignes (et EUX SEULS)", () => {
    // Une plage qui court de la fin de la ligne 1 au début de la ligne 3.
    expect(itemsOverlappingRanges(items, [{ start: 30, end: 90 }])).toEqual([1, 2, 3]);
  });

  it("cumule les items de PLUSIEURS plages disjointes sans doublon", () => {
    const hit = itemsOverlappingRanges(items, [
      { start: 0, end: 25 }, // en-tête (items 0-1)
      { start: 155, end: 170 }, // décision (item 5)
    ]);
    expect(hit).toEqual([0, 1, 5]);
  });

  it("retourne [] sans plage (pas de match → pas de marque, pas de crash)", () => {
    expect(itemsOverlappingRanges(items, [])).toEqual([]);
  });

  it("ignore les items hors plage (frontières exclusives)", () => {
    // Plage exactement entre deux items (l'espace séparateur) : aucun item.
    expect(itemsOverlappingRanges(items, [{ start: 20, end: 21 }])).toEqual([]);
  });
});
