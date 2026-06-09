import {
  CiblagePlan,
  type CiblagePlanInputT,
  type CiblagePlanPatchT,
  type CiblagePlanT,
} from "@radar/domain";

import type { ObjectStore } from "../../storage/object-store.js";

/**
 * CIBLAGE persistence (pipeline stage 1). Plans are PURE DECLARATIONS — no I/O is
 * triggered here; the store only reads/writes the plan documents that a later
 * RECUEIL execution will consume.
 *
 * Persistence choice: a single JSON index document in object storage
 * (`ciblage/index.json`), reusing the same S3/MinIO `ObjectStore` substrate as
 * the EXPLOITATION project-state (`ontology/<city>/project-state.json`). For a
 * small, demo-scale set of plans this is the lightest fit that stays consistent
 * with the codebase: no Drizzle migration, one round-trip to list, and the same
 * read/write boundary the rest of the pipeline already uses. If the plan set
 * ever grows beyond a handful, this is the seam to swap for a Drizzle table.
 */

/** Canonical S3 key holding the full array of ciblage plans. */
export const CIBLAGE_INDEX_KEY = "ciblage/index.json";

/** Build a kebab-case, store-unique-ish slug from a plan label. */
export function slugifyLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "ciblage"
  );
}

function serialize(plans: readonly CiblagePlanT[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(plans, null, 2) + "\n");
}

function parse(bytes: Uint8Array): CiblagePlanT[] {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!Array.isArray(raw)) return [];
  // Drop any malformed entry rather than crashing the whole list.
  const out: CiblagePlanT[] = [];
  for (const entry of raw) {
    const parsed = CiblagePlan.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Async store over the object-storage index document. */
export interface CiblageStore {
  list(): Promise<CiblagePlanT[]>;
  get(id: string): Promise<CiblagePlanT | undefined>;
  create(input: CiblagePlanInputT): Promise<CiblagePlanT>;
  update(id: string, patch: CiblagePlanPatchT): Promise<CiblagePlanT | undefined>;
  remove(id: string): Promise<boolean>;
}

export function createCiblageStore(
  store: ObjectStore,
  now: () => Date = () => new Date(),
): CiblageStore {
  async function readAll(): Promise<CiblagePlanT[]> {
    const head = await store.head(CIBLAGE_INDEX_KEY);
    if (!head) return [];
    const bytes = await store.get(CIBLAGE_INDEX_KEY);
    return parse(bytes);
  }

  async function writeAll(plans: readonly CiblagePlanT[]): Promise<void> {
    await store.put(CIBLAGE_INDEX_KEY, serialize(plans), "application/json");
  }

  function uniqueId(base: string, existing: readonly CiblagePlanT[]): string {
    const taken = new Set(existing.map((p) => p.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  return {
    list: () => readAll(),

    async get(id) {
      const all = await readAll();
      return all.find((p) => p.id === id);
    },

    async create(input) {
      const all = await readAll();
      const ts = now().toISOString();
      const plan: CiblagePlanT = CiblagePlan.parse({
        id: uniqueId(slugifyLabel(input.label), all),
        label: input.label,
        citySlugs: input.citySlugs,
        sourceBindingIds: input.sourceBindingIds,
        cadence: input.cadence,
        enabled: input.enabled,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdAt: ts,
        updatedAt: ts,
      });
      await writeAll([...all, plan]);
      return plan;
    },

    async update(id, patch) {
      const all = await readAll();
      const idx = all.findIndex((p) => p.id === id);
      if (idx === -1) return undefined;
      const existing = all[idx]!;
      const merged: CiblagePlanT = CiblagePlan.parse({
        ...existing,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.citySlugs !== undefined ? { citySlugs: patch.citySlugs } : {}),
        ...(patch.sourceBindingIds !== undefined
          ? { sourceBindingIds: patch.sourceBindingIds }
          : {}),
        ...(patch.cadence !== undefined ? { cadence: patch.cadence } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedAt: now().toISOString(),
      });
      const next = [...all];
      next[idx] = merged;
      await writeAll(next);
      return merged;
    },

    async remove(id) {
      const all = await readAll();
      const next = all.filter((p) => p.id !== id);
      if (next.length === all.length) return false;
      await writeAll(next);
      return true;
    },
  };
}
