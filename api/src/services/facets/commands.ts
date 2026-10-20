import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetCommands, type facetEvents } from "../../db/schema.js";
import { digest, FacetError } from "./target.js";
import type { FacetCommand } from "./writer.js";

export type FacetSnapshot = Omit<typeof facetEvents.$inferSelect, "createdAt"> & { createdAt: string };
export function facetCommandDigest(command: FacetCommand) {
  return digest({ action: command.action, target: command.target, basket: command.basket ?? null,
    reasonCode: command.reasonCode ?? null, deselect: [...new Set(command.deselect ?? [])].sort() });
}
export async function readCommand(
  db: Pick<Database, "select">, ownerId: string, key: string, commandDigest: string,
): Promise<FacetSnapshot | null | undefined> {
  const [receipt] = await db.select().from(facetCommands).where(and(
    eq(facetCommands.ownerId, ownerId), eq(facetCommands.commandKey, key),
  ));
  if (!receipt) return undefined;
  if (receipt.commandDigest !== commandDigest) throw new FacetError(409, "idempotency_key_conflict");
  return (receipt.result as { event: FacetSnapshot | null }).event;
}
