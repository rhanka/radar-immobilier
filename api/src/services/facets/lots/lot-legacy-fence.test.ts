import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../../db/client.js";
import { lotCutoverState } from "../../../db/schema.js";
import { legacyMarksFence } from "./lot-legacy-fence.js";

describe("6K legacy reader fence", () => {
  it("should report unknown when the database is unreadable or malformed", async () => {
    for (const select of [() => { throw new Error("unavailable"); },
      () => ({ from: () => ({}) })]) {
      expect(await legacyMarksFence({ select } as unknown as Database)).toBe("unknown");
    }
  });
  it("should keep legacy readers closed if a workspace state was removed", async () => {
    const db = { select: vi.fn(() => ({
      from: (table: unknown) => Promise.resolve(table === lotCutoverState ? [] : [{ enabled: true }]),
    })) } as unknown as Database;
    expect(await legacyMarksFence(db)).toBe("barrier");
  });
});
