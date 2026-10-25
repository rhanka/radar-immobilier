import { inArray } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEvents } from "../../db/schema.js";
import { readScopedPersonalHeads, type ScopedHead } from "./scoped-reader.js";
import { readWorkspaceArchiveCity, type WorkspaceArchiveHead, isEffectivelyDiscarded } from "./workspace-reader.js";
import { SignalFacets, Head, ArchiveHead } from "./classification-contracts.js";
import { nativeKey } from "./classification-population.js";
import type { SignalTarget } from "./target.js";
import type { z } from "zod";

export interface AuthorizedHeads {
  personal: Map<string, ScopedHead[]>;
  archives: Map<string, { personal: WorkspaceArchiveHead | null; workspace: WorkspaceArchiveHead | null }>;
  profiles: Map<string, string | null>;
}
export async function readClassificationHeads(db: Database, sub: string, workspaceId: string, citySlug: string): Promise<AuthorizedHeads> {
  const personal = await readScopedPersonalHeads(db, sub, workspaceId, citySlug);
  const archives = await readWorkspaceArchiveCity(db, sub, workspaceId, citySlug);
  // IDs originate exclusively in the authorized BASE readers above.
  const ids = [...new Set([...personal.map((head) => head.id), ...archives.flatMap((row) =>
    [row.personal?.id, row.workspace?.id].filter((id): id is string => id !== undefined))])];
  const profiles = ids.length === 0 ? [] : await db.select({ id: facetEvents.id, profileId: facetEvents.profileId })
    .from(facetEvents).where(inArray(facetEvents.id, ids));
  const byTarget = new Map<string, ScopedHead[]>();
  for (const head of personal) {
    const key = nativeKey(head.target as SignalTarget);
    byTarget.set(key, [...(byTarget.get(key) ?? []), head]);
  }
  return { personal: byTarget, archives: new Map(archives.map((row) => [nativeKey(row.target), row])),
    profiles: new Map(profiles.map((row) => [row.id, row.profileId])) };
}
export function projectFacets(heads: AuthorizedHeads, target: SignalTarget): z.infer<typeof SignalFacets> {
  const key = nativeKey(target);
  const personal = heads.personal.get(key) ?? [];
  const archives = heads.archives.get(key);
  const project = (head: ScopedHead | WorkspaceArchiveHead | null | undefined) => head ? Head.parse({
    id: head.id, state: head.state, createdAt: head.createdAt,
    reason: head.reasonCode === null ? null : { profileId: heads.profiles.get(head.id), code: head.reasonCode, verdict: head.verdict },
  }) : null;
  const archive = (head: WorkspaceArchiveHead | null | undefined) => head ? ArchiveHead.parse({
    ...project(head), changedSinceArchive: head.changedSinceArchive,
  }) : null;
  const selection = { pertinent: project(personal.find((head) => head.facet === "selection" && head.basket === "pertinent")),
    a_surveiller: project(personal.find((head) => head.facet === "selection" && head.basket === "a_surveiller")) };
  return SignalFacets.parse({ selection, archive: { personal: archive(archives?.personal), workspace: archive(archives?.workspace) },
    personalHistoryState: personal.length ? "has_history" : "untouched",
    personalHidden: archives?.personal?.state === "active", workspaceHidden: archives?.workspace?.state === "active",
    effectiveHidden: isEffectivelyDiscarded(archives?.personal ?? null, archives?.workspace ?? null),
  });
}
