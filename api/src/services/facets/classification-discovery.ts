import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { workspaceMemberships, workspaces } from "../../db/schema.js";
import { approvedAccountId } from "../workspaces/store.js";
import { ClassificationError } from "./classification-errors.js";
import { Availability, WorkspaceFacetContext } from "./classification-context-contract.js";
import { WorkspaceId } from "./classification-query.js";
import { readFacetContext } from "./classification-context.js";
import { digest } from "./target.js";

export const ConsumerFacetContext = z.object({ contractVersion: z.literal("facet-context-selector-v2"),
  transport: z.enum(["mcp", "h5"]),
  workspaces: z.array(z.object({ workspaceId: WorkspaceId, label: z.string() }).strict()),
  selectedWorkspace: WorkspaceFacetContext.nullable(),
  operations: z.array(z.object({ name: z.string().min(1), domain: z.enum(["context", "signal", "lot"]),
    scope: z.enum(["personal", "workspace", "both"]).nullable(), business: Availability, transport: Availability }).strict()),
}).strict().refine((value) => value.selectedWorkspace !== null || value.operations.length === 0);
const binary = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
async function memberships(db: Database, sub: string) {
  return db.transaction(async (tx) => {
    const accountId = await approvedAccountId(tx, sub, true);
    // Approval stays locked while one statement samples and locks the complete active set.
    const rows = await tx.select({ workspaceId: workspaces.id, label: workspaces.label }).from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
      .where(and(eq(workspaceMemberships.accountId, accountId), eq(workspaceMemberships.status, "active"))).for("share");
    return rows.sort((a, b) => binary(a.label, b.label) || binary(a.workspaceId, b.workspaceId));
  });
}
/** Transport manifests remain closed until their own receiver is qualified. */
export async function discoverFacetContext(db: Database, sub: string, transport: "mcp" | "h5", selector?: string) {
  if (selector !== undefined && !WorkspaceId.safeParse(selector).success) throw new ClassificationError("invalid_query");
  const before = await memberships(db, sub);
  const id = selector === undefined ? before.length === 1 ? before[0]!.workspaceId : undefined : WorkspaceId.parse(selector);
  if (id && !before.some((entry) => entry.workspaceId === id)) throw new ClassificationError("workspace_not_authorized");
  const selectedWorkspace = id ? await readFacetContext(db, sub, id) : null;
  const after = await memberships(db, sub);
  if (id && !after.some((entry) => entry.workspaceId === id)) throw new ClassificationError("workspace_not_authorized");
  if (digest(before) !== digest(after)) throw new ClassificationError("workspace_ambiguous");
  return ConsumerFacetContext.parse({ contractVersion: "facet-context-selector-v2", transport,
    workspaces: after, selectedWorkspace, operations: [] });
}
