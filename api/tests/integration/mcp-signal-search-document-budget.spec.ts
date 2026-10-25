import { expect, it, vi } from "vitest";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { readMcpSignalCards } from "../../src/services/facets/mcp-signal-search.js";
import { bumpGraphSourceRevision } from "../../src/services/facets/projection-revisions.js";
import { DOC_ENRICHMENT_BUDGET_MS } from "../../src/routes/graph-signals.js";
import * as graphStore from "../../src/services/graph/graph-store.js";
import { searchFixture, barrier } from "./mcp-signal-search-fixture.js";

describeDb("MCP request documentary budget across coherent retries", () => {
  it("shares one deadline and cache across retries without resolving new refs after expiry", async () => {
    const f = await searchFixture();
    const rawRef = "raw/synthetic/shared.pdf";
    await f.data.pool.query("UPDATE graph_nodes SET source_ref = $1 WHERE id = $2", [rawRef, f.signal.node.id]);
    const started = barrier(), resume = barrier();
    const head = vi.fn(async () => { started.release(); await resume.waiting; return null; });
    const store = { head } as unknown as ObjectStore;
    f.mount((sub, args) => readMcpSignalCards({ db: f.data.db, store }, sub, args));
    const beginning = Date.now();
    const pending = f.search();
    await started.waiting;
    try {
      await f.data.pool.query(`UPDATE graph_nodes SET label = 'After drift', props = $1 WHERE id = $2`,
        [{ refs: [{ rawRef, docSha: rawRef }, { rawRef: "raw/synthetic/new.pdf", docSha: "new" }] }, f.signal.node.id]);
      await bumpGraphSourceRevision(f.data.db, "synthetic-city");
      const response = await pending;
      const elapsed = Date.now() - beginning;
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result.cards[0].label).toBe("After drift");
      expect(body.result.cards[0].docRefs).toHaveLength(2);
      expect(head).toHaveBeenCalledTimes(1);
      expect(head).toHaveBeenCalledWith(rawRef + ".meta.json");
      // One second accommodates request setup and PostgreSQL scheduling; a reset costs another 2s.
      expect(elapsed).toBeLessThan(DOC_ENRICHMENT_BUDGET_MS + 1_000);
      expect(body.result.cards[0].docRefs[0]).not.toHaveProperty("publishedAt");
    } finally { resume.release(); }
  });
  it("refuses persistent revision drift after exactly the BASE bounded attempts", async () => {
    const f = await searchFixture();
    const original = graphStore.getSignalNodesForCity;
    let attempts = 0;
    const read = vi.spyOn(graphStore, "getSignalNodesForCity").mockImplementation(async (db, city) => {
      const nodes = await original(db, city);
      attempts += 1;
      await f.data.pool.query("UPDATE graph_nodes SET label = $1 WHERE id = $2", [`Drift ${attempts}`, f.signal.node.id]);
      await bumpGraphSourceRevision(f.data.db, "synthetic-city");
      return nodes;
    });
    try {
      f.mount((sub, args) => readMcpSignalCards({ db: f.data.db,
        store: { head: async () => null } as unknown as ObjectStore }, sub, args));
      const response = await f.search();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "projection_revision_unstable" });
      expect(attempts).toBe(3);
    } finally { read.mockRestore(); }
  });
});
