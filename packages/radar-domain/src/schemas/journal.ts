import { z } from "zod";
import { Mode } from "./common.js";
export const Action = z.enum([
  "rejeter","surveiller","qualifier-avec-expert","approcher-propriétaire","monter-dossier-acquisition"]);
export type ActionT = z.infer<typeof Action>;
export const JournalEntry = z.object({
  id: z.string(), who: z.string(), role: z.string(),
  action: z.string(), target: z.string(), at: z.string(),
  rationale: z.string().optional(), mode: Mode, supersedes: z.string().optional(),
});
export type JournalEntryT = z.infer<typeof JournalEntry>;
export const TimelineEvent = z.object({ at: z.string(), kind: z.string(), ref: z.string(), note: z.string().optional() });
export type TimelineEventT = z.infer<typeof TimelineEvent>;
