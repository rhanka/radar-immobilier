// Shared synthetic helpers for 6J lot DB tests. No operational data.
import { randomUUID } from "node:crypto";
import { facetEvents } from "../../../db/schema.js";
import { resolveLotSource } from "./lot-target.js";
import type { LotCommand, LotMutation } from "./lot-commands.js";
import type { LotFixture } from "./lot-fixture.js";

export async function displayedFor(f: LotFixture, index = 0) {
  const target = { type: "Lot" as const, authority: "lot_versions" as const,
    citySlug: "synthetic-6j-city",
    canonicalId: ["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"][index]! };
  return { target, displayed: (await resolveLotSource(f.db, target)).displayed };
}

export type DisplayedTarget = Awaited<ReturnType<typeof displayedFor>>;

export function lotCommand(
  target: DisplayedTarget["target"],
  displayed: DisplayedTarget["displayed"],
  mutation: LotMutation,
  expected_head_id: string | null = null,
): LotCommand {
  return {
    contract_version: "lot-facets-v1",
    command_key: randomUUID(),
    mode: "real",
    target,
    displayed_version: displayed,
    expected_head_id,
    mutation,
  };
}

export async function lotEventCount(f: LotFixture): Promise<number> {
  return (await f.db.select({ id: facetEvents.id }).from(facetEvents)).length;
}
