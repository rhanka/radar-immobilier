import { contractDateTime } from "@radar/domain";
import { z } from "zod";
import { Hash, Verdict } from "./classification-query.js";

export const Reason = z.object({ profileId: z.string().min(1), code: z.string().min(1), verdict: Verdict }).strict();
export const Head = z.object({ id: z.string().guid(), state: z.enum(["active", "inactive"]),
  createdAt: contractDateTime({ offset: true }), reason: Reason.nullable() }).strict();
export const ArchiveHead = Head.extend({ changedSinceArchive: z.boolean().nullable() });
export const SignalFacets = z.object({
  selection: z.object({ pertinent: Head.nullable(), a_surveiller: Head.nullable() }).strict(),
  archive: z.object({ personal: ArchiveHead.nullable(), workspace: ArchiveHead.nullable() }).strict(),
  personalHistoryState: z.enum(["untouched", "has_history"]),
  personalHidden: z.boolean(), workspaceHidden: z.boolean(), effectiveHidden: z.boolean(),
}).strict().superRefine((value, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "Invalid signal facet projection" });
  for (const basket of ["pertinent", "a_surveiller"] as const) {
    const head = value.selection[basket];
    if (head?.reason && head.reason.verdict !== basket) invalid();
  }
  for (const head of [value.archive.personal, value.archive.workspace]) {
    if (head?.state === "active" && head.reason?.verdict !== "non_pertinent") invalid();
    if (head?.reason && head.reason.verdict !== "non_pertinent") invalid();
    if (head?.state === "inactive" && head.changedSinceArchive !== null) invalid();
  }
  if (value.personalHidden !== (value.archive.personal?.state === "active")
    || value.workspaceHidden !== (value.archive.workspace?.state === "active")
    || value.effectiveHidden !== (value.personalHidden || value.workspaceHidden)) invalid();
  const history = !!(value.selection.pertinent || value.selection.a_surveiller || value.archive.personal);
  if ((value.personalHistoryState === "has_history") !== history) invalid();
});
export type SignalFacetsDto = z.infer<typeof SignalFacets>;
const count = z.number().int().nonnegative();
export const SignalCounts = z.object({ unit: z.literal("distinct_targets"),
  eligible: count, visible: count, discarded: count,
  discardedByScope: z.object({ personalOnly: count, workspaceOnly: count, both: count }).strict(),
  navigation: z.object({ basis: z.literal("after_content_personal_history_and_archive_before_basket"),
    population: count, pertinent: count, a_surveiller: count, selectedDistinct: count,
    selectionMemberships: count, unselected: count }).strict(), matched: count,
}).strict().superRefine((value, ctx) => {
  const n = value.navigation;
  const d = value.discardedByScope;
  if (value.eligible !== value.visible + value.discarded
    || value.discarded !== d.personalOnly + d.workspaceOnly + d.both
    || n.selectionMemberships !== n.pertinent + n.a_surveiller
    || n.population !== n.selectedDistinct + n.unselected
    || n.selectedDistinct > n.selectionMemberships || n.selectedDistinct > n.population
    || n.selectedDistinct < Math.max(n.pertinent, n.a_surveiller)
    || value.matched > n.population) ctx.addIssue({ code: "custom", message: "Invalid distinct counts" });
});
export const Snapshot = z.object({ kind: z.literal("signal-projection-v1"),
  baseToken: Hash, queryToken: Hash, queryDigest: Hash,
  projectionVersion: z.string().min(1), catalogVersion: z.string().min(1) }).strict();
export const Page = z.object({ limit: z.number().int().min(1).max(100),
  nextCursor: z.string().max(4096).nullable(), truncated: z.boolean() }).strict()
  .refine((value) => value.truncated === (value.nextCursor !== null));
