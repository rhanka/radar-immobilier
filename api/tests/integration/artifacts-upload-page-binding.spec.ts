import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactBinding } from "../../../packages/immo-mcp/src/artifact-binding.js";
import {
  ALICE,
  bindingRequest,
  body,
  SCOPE,
  startOuverture,
  type Ouverture,
} from "./artifacts-ouverture.helpers.js";

/**
 * B1 — the immo-mcp process mints browser upload pages through the same
 * shared wiring as the API (secret, application origin, pageBaseUrl, https
 * S3): the mint goes through `createArtifactBinding`, the real MCP path,
 * and lands the page row bound to the caller.
 */
describe("upload page mint on the MCP binding", () => {
  let h: Ouverture;
  let bound: NonNullable<Awaited<ReturnType<typeof createArtifactBinding>>>;
  beforeAll(async () => {
    h = await startOuverture("mcp_page");
    await h.memberships([]);
    const created = await createArtifactBinding({ ...h.bindingEnv });
    if (!created) throw new Error("artifact binding unavailable in general mode");
    bound = created;
  });
  afterAll(async () => { await bound?.close(); await h?.close(); });

  it("should mint a page on the application origin bound to the caller", async () => {
    const ensured = await bound.binding.invoke("artifacts_ensure",
      { bindingName: randomUUID(), idempotencyKey: randomUUID() }, bindingRequest(ALICE));
    expect(ensured.isError, JSON.stringify(ensured)).not.toBe(true);
    const artifactId = body(ensured).artifactId as string;
    const minted = await bound.binding.invoke("artifacts_create_upload_page",
      { artifactId }, bindingRequest(ALICE));
    expect(minted.isError, JSON.stringify(minted)).not.toBe(true);
    const page = body(minted) as { pageSessionId: string; uploadPageUrl: string };
    expect(page.uploadPageUrl)
      .toContain(`https://app.example.test/api/v1/artifacts/upload/${page.pageSessionId}#t=`);
    const token = new URL(page.uploadPageUrl).hash.replace(/^#t=/, "");
    expect(token.length).toBeGreaterThan(16);
    const rows = await h.pool.query<{ owner_id: string; storage_scope_id: string }>(
      "SELECT owner_id, storage_scope_id FROM artifacts.upload_pages WHERE id = $1", [page.pageSessionId]);
    expect(rows.rows).toEqual([{ owner_id: ALICE, storage_scope_id: SCOPE }]);
  });
});
