import { describe, expect, it } from "vitest";
import {
  buildAnnotationBadges,
  type AnnotationBadgeInput,
  type AnnotationBadgeVariant,
} from "./annotation-badge-model.js";

const VARIANTS: readonly AnnotationBadgeVariant[] = ["a", "b", "c"];

const AI_BASE: NonNullable<AnnotationBadgeInput["ai"]> = {
  classe: "a_surveiller",
  model: "gpt-6.2-astra",
  effort: "low",
  promptId: "v2",
  updatedAt: "2026-11-21T12:00:00.000Z",
};

describe("annotation badge model (design proposal)", () => {
  it.each(VARIANTS)("renders no badge for an unclassified signal in variant %s", (variant) => {
    expect(buildAnnotationBadges({}, variant)).toEqual([]);
  });

  it.each(VARIANTS)("keeps ariaLabel equal to tooltipText and includes full hover detail in variant %s", (variant) => {
    const cases: Array<{ name: string; input: AnnotationBadgeInput; expectedStates: string[]; mustContain: string[] }> = [
      {
        name: "AI",
        input: { ai: AI_BASE },
        expectedStates: ["ai"],
        mustContain: ["IA", "gpt-6.2-astra (low)", "Prompt : v2", "2026-11-21", "Canal : Pipeline"],
      },
      {
        name: "AI ambiguous",
        input: { ai: { ...AI_BASE, ambiguous: true } },
        expectedStates: ["ai-ambiguous"],
        mustContain: ["ambigu", "gpt-6.2-astra (low)", "Prompt : v2", "2026-11-21"],
      },
      {
        name: "Manual UI",
        input: { manual: { actor: "F. Antoine", updatedAt: "2026-11-21", channel: "UI" } },
        expectedStates: ["manual"],
        mustContain: ["Humain (Manuel)", "Acteur : F. Antoine", "2026-11-21", "Canal : UI"],
      },
      {
        name: "Human validated",
        input: { humanFeedback: { verdict: "up", actor: "F. Antoine", updatedAt: "2026-11-21", channel: "UI" } },
        expectedStates: ["human-validated"],
        mustContain: ["Humain (Validé)", "Acteur : F. Antoine", "Canal : UI"],
      },
      {
        name: "Human reclassified",
        input: { humanFeedback: { verdict: "down", actor: "F. Antoine", reasonCode: "N-NON-RES", updatedAt: "2026-11-21" } },
        expectedStates: ["human-reclassified"],
        mustContain: ["Humain (Reclassé, motif N-NON-RES)", "Acteur : F. Antoine", "Canal : UI"],
      },
      {
        name: "MCP pending",
        input: { mcp: { model: "claude-opus-4-6", validation: "auto", pendingHuman: true, updatedAt: "2026-11-21" } },
        expectedStates: ["mcp-pending"],
        mustContain: ["MCP (à confirmer)", "claude-opus-4-6", "Canal : MCP"],
      },
      {
        name: "MCP auto",
        input: { mcp: { model: "claude-opus-4-6", validation: "auto", pendingHuman: false, updatedAt: "2026-11-21" } },
        expectedStates: ["mcp-auto"],
        mustContain: ["MCP (validé auto)", "claude-opus-4-6", "Canal : MCP"],
      },
      {
        name: "Human via MCP + elicitation",
        input: {
          mcp: {
            model: "claude-opus-4-6",
            validation: "human",
            pendingHuman: false,
            actor: "F. Antoine",
            updatedAt: "2026-11-21",
          },
        },
        expectedStates: ["human-mcp-elicitation"],
        mustContain: ["Humain (MCP + élicitation)", "Acteur : F. Antoine", "claude-opus-4-6", "Canal : MCP + élicitation"],
      },
    ];

    for (const c of cases) {
      const badges = buildAnnotationBadges(c.input, variant);
      expect(badges.map((b) => b.state), c.name).toEqual(c.expectedStates);
      for (const badge of badges) {
        expect(badge.ariaLabel, c.name).toBe(badge.tooltipText);
      }
      const combined = badges.map((b) => b.tooltipText).join(" | ");
      for (const fragment of c.mustContain) {
        expect(combined, `${c.name} missing ${fragment}`).toContain(fragment);
      }
    }
  });

  it.each(VARIANTS)("renders both human and AI badges together with distinct model detail in variant %s", (variant) => {
    const validatedPlusAi = buildAnnotationBadges(
      {
        humanFeedback: { verdict: "down", actor: "F. Antoine", reasonCode: "P-DENSIF", updatedAt: "2026-11-21" },
        ai: AI_BASE,
      },
      variant,
    );
    expect(validatedPlusAi.map((b) => b.state)).toEqual(["human-reclassified", "ai"]);
    expect(validatedPlusAi[0]!.tooltipText).toContain("Humain (Reclassé, motif P-DENSIF)");
    expect(validatedPlusAi[1]!.tooltipText).toContain("gpt-6.2-astra (low)");

    const elicitationPlusAi = buildAnnotationBadges(
      {
        mcp: { model: "claude-opus-4-6", validation: "human", actor: "F. Antoine", updatedAt: "2026-11-21" },
        ai: AI_BASE,
      },
      variant,
    );
    expect(elicitationPlusAi.map((b) => b.state)).toEqual(["human-mcp-elicitation", "ai"]);
    expect(elicitationPlusAi[0]!.shortLabel).toBe("MCP + élicitation");
    expect(elicitationPlusAi[1]!.tooltipText).toContain("gpt-6.2-astra (low)");
  });
});
