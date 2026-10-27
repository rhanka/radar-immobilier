import { z } from "zod";
import { CitySlug, Hash, NativeTarget, WorkspaceId } from "./classification-query.js";
import { SignalCard } from "./classification-card.js";
import { Page, SignalCounts, SignalFacets, Snapshot } from "./classification-contracts.js";

export const SignalItem = z.object({ target: NativeTarget, readiness: z.literal("ready"),
  displayedFingerprint: Hash, card: SignalCard, facets: SignalFacets }).strict();
export const SignalSearchResponse = z.object({ ok: z.literal(true), contractVersion: z.literal("signal-classifications-v1"),
  workspaceId: WorkspaceId, citySlug: CitySlug, mode: z.literal("signal"), population: z.literal("signal_nodes_v1"),
  snapshot: Snapshot, counts: SignalCounts, items: z.array(SignalItem).max(100), page: Page,
}).strict();
