import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetCommands, type facetEvents } from "../../db/schema.js";
import { digest, FacetError } from "./target.js";
import type { FacetCommand } from "./writer.js";

export type FacetSnapshot = Omit<typeof facetEvents.$inferSelect, "createdAt"> & { createdAt: string };

/** Contract version pinned into every 6A digest. */
export const FACET_CONTRACT_VERSION = "signal-facets-v1";

function normalizeExpectedSelectionHeads(
  value: FacetCommand["expectedSelectionHeads"],
): Record<string, string | null> | null {
  if (value === undefined) return null;
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries.map(([basket, headId]) => [basket, headId ?? null]));
}

export function facetCommandDigest(command: FacetCommand) {
  return digest({ version: FACET_CONTRACT_VERSION, action: command.action, target: command.target,
    basket: command.basket ?? null, reasonCode: command.reasonCode ?? null,
    deselect: [...new Set(command.deselect ?? [])].sort(),
    expectedHeadId: command.expectedHeadId ?? null,
    expectedSelectionHeads: normalizeExpectedSelectionHeads(command.expectedSelectionHeads) });
}

/** Old payloads are used exclusively to recover an immutable receipt. */
export function historicalCommandDigest(command: Omit<FacetCommand, "expectedHeadId">) {
  return digest({ action: command.action, target: command.target, basket: command.basket ?? null,
    reasonCode: command.reasonCode ?? null, deselect: [...new Set(command.deselect ?? [])].sort() });
}

interface StoredFacetReceipt {
  event: FacetSnapshot | null;
  context?: unknown;
}

export async function readCommand(
  db: Pick<Database, "select">, ownerId: string, key: string, commandDigest: string,
): Promise<FacetSnapshot | null | undefined> {
  const [receipt] = await db.select().from(facetCommands).where(and(
    eq(facetCommands.ownerId, ownerId), eq(facetCommands.commandKey, key),
  ));
  if (!receipt) return undefined;
  const stored = receipt.result as StoredFacetReceipt;
  if (stored.event === null && stored.context === undefined) {
    throw new FacetError(409, "command_context_unresolved");
  }
  if (receipt.commandDigest !== commandDigest) throw new FacetError(409, "idempotency_key_conflict");
  return stored.event;
}
