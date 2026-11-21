export type AnnotationBadgeVariant = "a" | "b" | "c";

export type AnnotationBadgeState =
  | "ai"
  | "ai-ambiguous"
  | "manual"
  | "human-validated"
  | "human-reclassified"
  | "mcp-pending"
  | "mcp-auto"
  | "human-mcp-elicitation";

export type AnnotationBadgeIcon =
  | "sparkles"
  | "bot"
  | "triangle-alert"
  | "user"
  | "user-check"
  | "user-pen"
  | "shield-check"
  | "plug"
  | "clock";

export type AnnotationBadgeSecondaryIcon = "triangle-alert" | "clock" | "check";

export type AnnotationBadgeTone = "neutral" | "info" | "success" | "warning";

export type AnnotationChannel = "Pipeline" | "UI" | "MCP" | "MCP + élicitation" | "Import";

export interface AnnotationBadgeInput {
  /** Current AI annotation (remains visible even when a human class exists). */
  ai?: {
    classe?: "pertinent" | "a_surveiller" | "ecarte" | "non_classe";
    ambiguous?: boolean;
    model: string | null;
    effort?: string | null;
    promptId?: string | null;
    updatedAt?: string;
    channel?: AnnotationChannel;
  };
  /** Human feedback on an AI class (thumbs up = validated, thumbs down = reclassified). */
  humanFeedback?: {
    verdict: "up" | "down";
    actor?: string;
    reasonCode?: string;
    updatedAt?: string;
    channel?: AnnotationChannel;
  };
  /** Direct human manual classification in UI or import. */
  manual?: {
    actor?: string;
    updatedAt?: string;
    channel?: AnnotationChannel;
  };
  /** MCP annotation (pending human confirmation, auto-validated, or human via elicitation). */
  mcp?: {
    model: string | null;
    validation: "auto" | "human";
    pendingHuman?: boolean;
    actor?: string;
    updatedAt?: string;
  };
}

export interface AnnotationBadgeDescriptor {
  readonly id: string;
  readonly state: AnnotationBadgeState;
  readonly tone: AnnotationBadgeTone;
  readonly icon: AnnotationBadgeIcon;
  readonly secondaryIcon?: AnnotationBadgeSecondaryIcon;
  readonly shortLabel: string | null;
  readonly tooltipText: string;
  readonly ariaLabel: string;
  readonly shape: "circle" | "pill";
  readonly component: "badge" | "tag";
}

const CLASSE_LABELS: Record<string, string> = {
  pertinent: "Pertinent",
  a_surveiller: "À surveiller",
  ecarte: "Écarté",
  non_classe: "Non classé",
};

function formatIsoDate(value?: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("fr-CA", { timeZone: "UTC" });
}

function joinParts(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

function buildAiTooltip(ai: NonNullable<AnnotationBadgeInput["ai"]>): string {
  const classeLabel = ai.classe && ai.classe !== "non_classe" ? CLASSE_LABELS[ai.classe] : null;
  const sourceDetail = [ai.ambiguous ? "ambigu" : null, classeLabel].filter(Boolean).join(", ");
  const model = ai.model?.trim() || "modèle inconnu";
  const modelText = ai.effort?.trim() ? `${model} (${ai.effort.trim()})` : model;
  const date = formatIsoDate(ai.updatedAt);
  return joinParts([
    `Source : IA${sourceDetail ? ` (${sourceDetail})` : ""}`,
    `Modèle : ${modelText}`,
    ai.promptId ? `Prompt : ${ai.promptId}` : "Prompt : inconnu",
    date ? `Date : ${date}` : null,
    `Canal : ${ai.channel ?? "Pipeline"}`,
  ]);
}

function buildHumanTooltip(
  label: string,
  meta: { actor?: string; reasonCode?: string; model?: string | null; updatedAt?: string; channel: AnnotationChannel },
): string {
  const date = formatIsoDate(meta.updatedAt);
  const qualifier = meta.reasonCode ? `${label}, motif ${meta.reasonCode}` : label;
  return joinParts([
    `Source : Humain (${qualifier})`,
    meta.actor ? `Acteur : ${meta.actor}` : null,
    meta.model !== undefined ? `Modèle : ${meta.model?.trim() || "modèle inconnu"}` : null,
    date ? `Date : ${date}` : null,
    `Canal : ${meta.channel}`,
  ]);
}

function buildMcpTooltip(mcp: NonNullable<AnnotationBadgeInput["mcp"]>): string {
  const date = formatIsoDate(mcp.updatedAt);
  const status = mcp.pendingHuman ? "à confirmer" : "validé auto";
  return joinParts([
    `Source : MCP (${status})`,
    `Modèle : ${mcp.model?.trim() || "modèle inconnu"}`,
    date ? `Date : ${date}` : null,
    "Canal : MCP",
  ]);
}

function styleFor(
  state: AnnotationBadgeState,
  variant: AnnotationBadgeVariant,
): Omit<AnnotationBadgeDescriptor, "id" | "state" | "tooltipText" | "ariaLabel"> {
  if (variant === "a") {
    switch (state) {
      case "ai":
        return { component: "badge", shape: "circle", tone: "info", icon: "sparkles", shortLabel: null };
      case "ai-ambiguous":
        return {
          component: "badge", shape: "pill", tone: "warning",
          icon: "sparkles", secondaryIcon: "triangle-alert", shortLabel: null,
        };
      case "manual":
        return { component: "badge", shape: "circle", tone: "neutral", icon: "user", shortLabel: null };
      case "human-validated":
        return { component: "badge", shape: "circle", tone: "success", icon: "user-check", shortLabel: null };
      case "human-reclassified":
        return { component: "badge", shape: "circle", tone: "success", icon: "user-pen", shortLabel: null };
      case "mcp-pending":
        return {
          component: "badge", shape: "pill", tone: "warning",
          icon: "plug", secondaryIcon: "clock", shortLabel: null,
        };
      case "mcp-auto":
        return {
          component: "badge", shape: "pill", tone: "info",
          icon: "plug", secondaryIcon: "check", shortLabel: null,
        };
      case "human-mcp-elicitation":
        return {
          component: "badge", shape: "pill", tone: "success",
          icon: "user-check", shortLabel: "MCP + élicitation",
        };
    }
  }

  if (variant === "b") {
    switch (state) {
      case "ai":
        return { component: "badge", shape: "pill", tone: "info", icon: "bot", shortLabel: "IA" };
      case "ai-ambiguous":
        return { component: "badge", shape: "pill", tone: "warning", icon: "triangle-alert", shortLabel: "IA ambigu" };
      case "manual":
        return { component: "badge", shape: "pill", tone: "neutral", icon: "user", shortLabel: "Manuel" };
      case "human-validated":
        return { component: "badge", shape: "pill", tone: "success", icon: "user-check", shortLabel: "Validé" };
      case "human-reclassified":
        return { component: "badge", shape: "pill", tone: "success", icon: "user-pen", shortLabel: "Reclassé" };
      case "mcp-pending":
        return { component: "badge", shape: "pill", tone: "warning", icon: "clock", shortLabel: "MCP" };
      case "mcp-auto":
        return { component: "badge", shape: "pill", tone: "info", icon: "plug", shortLabel: "MCP" };
      case "human-mcp-elicitation":
        return {
          component: "badge", shape: "pill", tone: "success",
          icon: "user-check", shortLabel: "MCP + élicitation",
        };
    }
  }

  // Variant C — calm DS Tag palette (only alerts and human validations take strong color).
  switch (state) {
    case "ai":
      return { component: "tag", shape: "pill", tone: "neutral", icon: "bot", shortLabel: "IA" };
    case "ai-ambiguous":
      return {
        component: "tag", shape: "pill", tone: "warning",
        icon: "bot", secondaryIcon: "triangle-alert", shortLabel: "IA",
      };
    case "manual":
      return { component: "tag", shape: "pill", tone: "neutral", icon: "user", shortLabel: "Humain" };
    case "human-validated":
      return { component: "tag", shape: "pill", tone: "success", icon: "shield-check", shortLabel: "Humain" };
    case "human-reclassified":
      return { component: "tag", shape: "pill", tone: "info", icon: "user-pen", shortLabel: "Humain" };
    case "mcp-pending":
      return {
        component: "tag", shape: "pill", tone: "warning",
        icon: "plug", secondaryIcon: "clock", shortLabel: "MCP",
      };
    case "mcp-auto":
      return {
        component: "tag", shape: "pill", tone: "neutral",
        icon: "plug", secondaryIcon: "check", shortLabel: "MCP",
      };
    case "human-mcp-elicitation":
      return {
        component: "tag", shape: "pill", tone: "success",
        icon: "shield-check", shortLabel: "MCP + élicitation",
      };
  }
}

/**
 * Resolve the compact badge descriptors for one signal.
 *
 * Owner rules preserved:
 * - Unclassified signals return an empty array (no badge).
 * - A human class AND an AI class with its model are both rendered side by side.
 * - An MCP class validated by human elicitation is treated as human with the
 *   explicit "MCP + élicitation" tag.
 * - Every badge exposes the exact same rich text in `tooltipText` and `ariaLabel`.
 */
export function buildAnnotationBadges(
  input: AnnotationBadgeInput,
  variant: AnnotationBadgeVariant,
): AnnotationBadgeDescriptor[] {
  const badges: AnnotationBadgeDescriptor[] = [];

  if (input.mcp && !input.mcp.pendingHuman && input.mcp.validation === "human") {
    const tooltipText = buildHumanTooltip("MCP + élicitation", {
      actor: input.mcp.actor,
      model: input.mcp.model,
      updatedAt: input.mcp.updatedAt,
      channel: "MCP + élicitation",
    });
    badges.push({
      id: "human-mcp-elicitation",
      state: "human-mcp-elicitation",
      tooltipText,
      ariaLabel: tooltipText,
      ...styleFor("human-mcp-elicitation", variant),
    });
  } else if (input.humanFeedback) {
    const state: AnnotationBadgeState =
      input.humanFeedback.verdict === "up" ? "human-validated" : "human-reclassified";
    const tooltipText = buildHumanTooltip(
      input.humanFeedback.verdict === "up" ? "Validé" : "Reclassé",
      {
        actor: input.humanFeedback.actor,
        reasonCode: input.humanFeedback.reasonCode,
        updatedAt: input.humanFeedback.updatedAt,
        channel: input.humanFeedback.channel ?? "UI",
      },
    );
    badges.push({
      id: state,
      state,
      tooltipText,
      ariaLabel: tooltipText,
      ...styleFor(state, variant),
    });
  } else if (input.manual) {
    const tooltipText = buildHumanTooltip("Manuel", {
      actor: input.manual.actor,
      updatedAt: input.manual.updatedAt,
      channel: input.manual.channel ?? "UI",
    });
    badges.push({
      id: "manual",
      state: "manual",
      tooltipText,
      ariaLabel: tooltipText,
      ...styleFor("manual", variant),
    });
  } else if (input.mcp) {
    const state: AnnotationBadgeState = input.mcp.pendingHuman ? "mcp-pending" : "mcp-auto";
    const tooltipText = buildMcpTooltip(input.mcp);
    badges.push({
      id: state,
      state,
      tooltipText,
      ariaLabel: tooltipText,
      ...styleFor(state, variant),
    });
  }

  if (input.ai) {
    const state: AnnotationBadgeState = input.ai.ambiguous ? "ai-ambiguous" : "ai";
    const tooltipText = buildAiTooltip(input.ai);
    badges.push({
      id: state,
      state,
      tooltipText,
      ariaLabel: tooltipText,
      ...styleFor(state, variant),
    });
  }

  return badges;
}
