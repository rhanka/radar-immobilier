import { contractInteger } from "@radar/domain";
import { z } from "zod";
import { ClassificationError } from "./classification-errors.js";

export const WorkspaceId = z.string().guid().transform((value) => value.toLowerCase());
export const CitySlug = z.string().min(1).max(128).regex(/^[a-z0-9-]+$/);
export const NativeTarget = z.object({ citySlug: CitySlug,
  type: z.enum(["Signal", "DesignationEvent"]), id: z.string().min(1).max(512) }).strict();
export const Basket = z.enum(["pertinent", "a_surveiller"]);
export const Verdict = z.enum(["pertinent", "a_surveiller", "non_pertinent"]);
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const Stage = z.enum(["avis_motion", "projet_reglement", "consultation_publique",
  "second_projet", "adoption", "entree_vigueur", "inconnu"]);
export const QUERY_PROFILE = "signal-query-basic-v1" as const;
export const SignalQuery = z.object({
  citySlug: CitySlug, basket: z.enum(["all", "none", "pertinent", "a_surveiller"]).default("all"),
  archive: z.enum(["exclude", "include", "only"]).default("exclude"),
  personalHistory: z.enum(["any", "untouched", "has_history"]).default("any"),
  dateBasis: z.literal("document").default("document"),
  sort: z.literal("freshness_desc").default("freshness_desc"),
  limit: contractInteger().min(1).max(100).default(20),
  cursor: z.string().min(1).max(4096).optional(),
}).strict();
export type SignalQueryArgs = z.infer<typeof SignalQuery>;
export const StateQuery = NativeTarget.extend({ reveal: z.boolean().default(false) });

export function decodeQuery<T extends z.ZodTypeAny>(params: URLSearchParams, schema: T): z.infer<T> {
  const input: Record<string, unknown> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) throw new ClassificationError("invalid_query");
    Object.defineProperty(input, key, { value, enumerable: true, configurable: true, writable: true });
  }
  if (input.limit !== undefined) {
    if (!/^[1-9][0-9]*$/.test(String(input.limit))) throw new ClassificationError("invalid_query");
    input.limit = Number(input.limit);
  }
  if (input.reveal !== undefined) {
    if (input.reveal !== "true" && input.reveal !== "false") throw new ClassificationError("invalid_query");
    input.reveal = input.reveal === "true";
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ClassificationError("invalid_query");
  return parsed.data;
}
