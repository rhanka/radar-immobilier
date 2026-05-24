import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import { sources } from "../../src/db/schema.js";

const { db, pool } = createDb(loadConfig());

afterAll(async () => {
  await pool.end();
});

describe("db integration", () => {
  it("inserts and reads back a source row", async () => {
    const [inserted] = await db
      .insert(sources)
      .values({
        kind: "avis-publics",
        city: "salaberry-de-valleyfield",
        url: "https://example.test/avis",
        config: { rateLimitMs: 2000 },
      })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted.id).toBeTypeOf("string");
    expect(inserted.enabled).toBe(true);

    const found = await db
      .select()
      .from(sources)
      .where(eq(sources.id, inserted.id));

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("avis-publics");
    expect(found[0]?.config).toEqual({ rateLimitMs: 2000 });

    await db.delete(sources).where(eq(sources.id, inserted.id));
  });
});
