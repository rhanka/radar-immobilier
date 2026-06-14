import { describe, expect, it } from "vitest";
import {
  ProspectContactInput,
  ProspectDimension,
  ProspectMark,
  ProspectMarkInput,
  ProspectMarkMarcheInput,
  ProspectMarkPipelineInput,
  ProspectMode,
  ProspectNoteInput,
  ProspectStatut,
  ProspectStatutMarche,
  ProspectStatutPipeline,
} from "./prospect-mark.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_AUTHOR_ID = "00000000-0000-0000-0000-000000000001";
const VALID_LOT_VERSION_ID = "00000000-0000-0000-0000-000000000002";
const VALID_MARK_ID = "00000000-0000-0000-0000-000000000003";

const BASE_PIPELINE_INPUT = {
  lotVersionId: VALID_LOT_VERSION_ID,
  noLot: "3 247 789",
  citySlug: "salaberry-de-valleyfield",
  dimension: "pipeline" as const,
  statut: "favori" as const,
  authorId: VALID_AUTHOR_ID,
};

const BASE_MARCHE_INPUT = {
  lotVersionId: VALID_LOT_VERSION_ID,
  noLot: "3 247 789",
  citySlug: "salaberry-de-valleyfield",
  dimension: "marche" as const,
  statut: "en_vente" as const,
  authorId: VALID_AUTHOR_ID,
};

// ─── ProspectDimension ────────────────────────────────────────────────────────

describe("ProspectDimension", () => {
  it("accepte pipeline et marche", () => {
    expect(ProspectDimension.parse("pipeline")).toBe("pipeline");
    expect(ProspectDimension.parse("marche")).toBe("marche");
  });

  it("rejette une valeur inconnue", () => {
    expect(ProspectDimension.safeParse("funnel").success).toBe(false);
  });
});

// ─── ProspectStatut ───────────────────────────────────────────────────────────

describe("ProspectStatutPipeline", () => {
  it("accepte les quatre statuts pipeline", () => {
    for (const s of ["favori", "ecarte", "sollicite", "lettre_envoyee"] as const) {
      expect(ProspectStatutPipeline.parse(s)).toBe(s);
    }
  });

  it("rejette en_vente (dimension marche)", () => {
    expect(ProspectStatutPipeline.safeParse("en_vente").success).toBe(false);
  });
});

describe("ProspectStatutMarche", () => {
  it("accepte en_vente uniquement", () => {
    expect(ProspectStatutMarche.parse("en_vente")).toBe("en_vente");
  });

  it("rejette favori (dimension pipeline)", () => {
    expect(ProspectStatutMarche.safeParse("favori").success).toBe(false);
  });
});

describe("ProspectStatut (union)", () => {
  it("accepte toutes les valeurs connues", () => {
    for (const s of ["favori", "ecarte", "sollicite", "lettre_envoyee", "en_vente"] as const) {
      expect(ProspectStatut.parse(s)).toBe(s);
    }
  });

  it("rejette une valeur inconnue", () => {
    expect(ProspectStatut.safeParse("interesse").success).toBe(false);
  });
});

// ─── ProspectMode ─────────────────────────────────────────────────────────────

describe("ProspectMode", () => {
  it("accepte real et simulation", () => {
    expect(ProspectMode.parse("real")).toBe("real");
    expect(ProspectMode.parse("simulation")).toBe("simulation");
  });

  it("rejette une valeur inconnue", () => {
    expect(ProspectMode.safeParse("test").success).toBe(false);
  });
});

// ─── ProspectMarkPipelineInput ────────────────────────────────────────────────

describe("ProspectMarkPipelineInput", () => {
  it("accepte un input pipeline valide", () => {
    const parsed = ProspectMarkPipelineInput.parse(BASE_PIPELINE_INPUT);
    expect(parsed.dimension).toBe("pipeline");
    expect(parsed.statut).toBe("favori");
    expect(parsed.mode).toBe("real"); // valeur par défaut
  });

  it("accepte tous les statuts pipeline", () => {
    for (const s of ["favori", "ecarte", "sollicite", "lettre_envoyee"] as const) {
      expect(ProspectMarkPipelineInput.parse({ ...BASE_PIPELINE_INPUT, statut: s }).statut).toBe(s);
    }
  });

  it("rejette en_vente comme statut pour pipeline", () => {
    expect(
      ProspectMarkPipelineInput.safeParse({ ...BASE_PIPELINE_INPUT, statut: "en_vente" }).success,
    ).toBe(false);
  });

  it("accepte un supersedes optionnel", () => {
    const parsed = ProspectMarkPipelineInput.parse({
      ...BASE_PIPELINE_INPUT,
      supersedes: VALID_MARK_ID,
    });
    expect(parsed.supersedes).toBe(VALID_MARK_ID);
  });

  it("rejette un supersedes qui n'est pas un UUID", () => {
    expect(
      ProspectMarkPipelineInput.safeParse({ ...BASE_PIPELINE_INPUT, supersedes: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejette un noLot vide", () => {
    expect(
      ProspectMarkPipelineInput.safeParse({ ...BASE_PIPELINE_INPUT, noLot: "" }).success,
    ).toBe(false);
  });
});

// ─── ProspectMarkMarcheInput ──────────────────────────────────────────────────

describe("ProspectMarkMarcheInput", () => {
  it("accepte un input marche valide", () => {
    const parsed = ProspectMarkMarcheInput.parse(BASE_MARCHE_INPUT);
    expect(parsed.dimension).toBe("marche");
    expect(parsed.statut).toBe("en_vente");
  });

  it("accepte prix_demande et lien_annonce optionnels", () => {
    const parsed = ProspectMarkMarcheInput.parse({
      ...BASE_MARCHE_INPUT,
      prixDemande: 450_000,
      lienAnnonce: "https://centris.ca/abc123",
    });
    expect(parsed.prixDemande).toBe(450_000);
    expect(parsed.lienAnnonce).toBe("https://centris.ca/abc123");
  });

  it("rejette un prix négatif", () => {
    expect(
      ProspectMarkMarcheInput.safeParse({ ...BASE_MARCHE_INPUT, prixDemande: -1 }).success,
    ).toBe(false);
  });

  it("rejette un lien_annonce qui n'est pas une URL", () => {
    expect(
      ProspectMarkMarcheInput.safeParse({ ...BASE_MARCHE_INPUT, lienAnnonce: "pas-une-url" }).success,
    ).toBe(false);
  });

  it("rejette le statut favori pour la dimension marche", () => {
    expect(
      ProspectMarkMarcheInput.safeParse({ ...BASE_MARCHE_INPUT, statut: "favori" }).success,
    ).toBe(false);
  });
});

// ─── ProspectMarkInput (union discriminée) ────────────────────────────────────

describe("ProspectMarkInput (discriminatedUnion)", () => {
  it("route correctement vers pipeline", () => {
    const parsed = ProspectMarkInput.parse(BASE_PIPELINE_INPUT);
    expect(parsed.dimension).toBe("pipeline");
  });

  it("route correctement vers marche", () => {
    const parsed = ProspectMarkInput.parse(BASE_MARCHE_INPUT);
    expect(parsed.dimension).toBe("marche");
  });

  it("rejette une dimension inconnue", () => {
    expect(ProspectMarkInput.safeParse({ ...BASE_PIPELINE_INPUT, dimension: "autre" }).success).toBe(
      false,
    );
  });
});

// ─── ProspectMark (lecture base) ─────────────────────────────────────────────

describe("ProspectMark", () => {
  it("parse un marquage pipeline complet depuis la base", () => {
    const parsed = ProspectMark.parse({
      id: VALID_MARK_ID,
      lotVersionId: VALID_LOT_VERSION_ID,
      noLot: "3 247 789",
      citySlug: "salaberry-de-valleyfield",
      dimension: "pipeline",
      statut: "sollicite",
      mode: "real",
      authorId: VALID_AUTHOR_ID,
      supersedes: null,
      supersededBy: null,
      prixDemande: null,
      lienAnnonce: null,
      createdAt: "2026-06-14T00:00:00.000Z",
    });
    expect(parsed.id).toBe(VALID_MARK_ID);
    expect(parsed.statut).toBe("sollicite");
  });

  it("parse un marquage marche avec prix", () => {
    const parsed = ProspectMark.parse({
      id: VALID_MARK_ID,
      lotVersionId: VALID_LOT_VERSION_ID,
      noLot: "3 247 789",
      citySlug: "salaberry-de-valleyfield",
      dimension: "marche",
      statut: "en_vente",
      mode: "simulation",
      authorId: VALID_AUTHOR_ID,
      supersedes: null,
      supersededBy: null,
      prixDemande: "450000.00", // pg sérialise NUMERIC en string
      lienAnnonce: "https://centris.ca/abc123",
      createdAt: "2026-06-14T00:00:00.000Z",
    });
    expect(parsed.prixDemande).toBe("450000.00");
    expect(parsed.mode).toBe("simulation");
  });
});

// ─── ProspectNoteInput ────────────────────────────────────────────────────────

describe("ProspectNoteInput", () => {
  it("accepte une note valide", () => {
    const parsed = ProspectNoteInput.parse({
      noLot: "3 247 789",
      citySlug: "salaberry-de-valleyfield",
      authorId: VALID_AUTHOR_ID,
      body: "Propriétaire favorable, rappeler en septembre.",
    });
    expect(parsed.mode).toBe("real"); // défaut
  });

  it("rejette un body vide", () => {
    expect(
      ProspectNoteInput.safeParse({
        noLot: "3 247 789",
        citySlug: "salaberry-de-valleyfield",
        authorId: VALID_AUTHOR_ID,
        body: "",
      }).success,
    ).toBe(false);
  });

  it("rejette un body trop long (> 10 000 caractères)", () => {
    expect(
      ProspectNoteInput.safeParse({
        noLot: "3 247 789",
        citySlug: "salaberry-de-valleyfield",
        authorId: VALID_AUTHOR_ID,
        body: "x".repeat(10_001),
      }).success,
    ).toBe(false);
  });

  it("rejette un authorId invalide", () => {
    expect(
      ProspectNoteInput.safeParse({
        noLot: "3 247 789",
        citySlug: "salaberry-de-valleyfield",
        authorId: "pas-un-uuid",
        body: "note valide",
      }).success,
    ).toBe(false);
  });
});

// ─── ProspectContactInput (PII Loi 25) ───────────────────────────────────────

describe("ProspectContactInput", () => {
  it("accepte un contact minimal (sans données PII)", () => {
    const parsed = ProspectContactInput.parse({
      noLot: "3 247 789",
      citySlug: "salaberry-de-valleyfield",
      authorId: VALID_AUTHOR_ID,
    });
    expect(parsed.noLot).toBe("3 247 789");
    expect(parsed.proprietaireNom).toBeUndefined();
  });

  it("accepte un contact complet avec données PII", () => {
    const parsed = ProspectContactInput.parse({
      noLot: "3 247 789",
      citySlug: "salaberry-de-valleyfield",
      authorId: VALID_AUTHOR_ID,
      proprietaireNom: "Jean Tremblay",
      proprietaireTel: "450-555-0123",
      proprietaireCourriel: "j.tremblay@example.com",
      proprietaireAdresse: "123 rue Principale, Valleyfield QC J6S 1A1",
      sourceInfo: "role-foncier",
    });
    expect(parsed.proprietaireNom).toBe("Jean Tremblay");
    expect(parsed.proprietaireCourriel).toBe("j.tremblay@example.com");
  });

  it("rejette un courriel invalide", () => {
    expect(
      ProspectContactInput.safeParse({
        noLot: "3 247 789",
        citySlug: "salaberry-de-valleyfield",
        authorId: VALID_AUTHOR_ID,
        proprietaireCourriel: "pas-un-email",
      }).success,
    ).toBe(false);
  });

  it("rejette un nom trop long (> 500 chars)", () => {
    expect(
      ProspectContactInput.safeParse({
        noLot: "3 247 789",
        citySlug: "salaberry-de-valleyfield",
        authorId: VALID_AUTHOR_ID,
        proprietaireNom: "x".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("accepte un supersedes optionnel pour l'append-only", () => {
    const parsed = ProspectContactInput.parse({
      noLot: "3 247 789",
      citySlug: "salaberry-de-valleyfield",
      authorId: VALID_AUTHOR_ID,
      supersedes: VALID_MARK_ID,
    });
    expect(parsed.supersedes).toBe(VALID_MARK_ID);
  });
});
