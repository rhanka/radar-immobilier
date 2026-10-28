import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { confirmPwSignalWrite } from "../../src/services/facets/pw-write-confirm.js";
import { httpFixture } from "./base-api-http-fixture.js";

describeDb("PW-D createApp wiring", () => {
  it("should keep unconfigured write transport closed and persist BASE on the app database", async () => {
    const { data, request } = await httpFixture();
    const input = await preparedSelect(data);
    const prepare = await request("/api/v1/artifacts/reader/facets/write-intents",
      data.contributor.sub, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(prepare.status).toBe(503);
    expect(prepare.headers.get("cache-control")).toBe("private, no-store");
    expect(await prepare.json()).toMatchObject({ operation: "facets.write-intents.prepare.v1",
      error: { code: "write_transport_closed", action: "contact_operator" } });
    const row = await pwPrepared(data, input);
    const missing = await request(`/api/v1/artifacts/write-intents/${row.intentId}/confirm`,
      data.contributor.sub, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: "x" }) });
    expect(missing.status).toBe(503);
    const result = await confirmPwSignalWrite(data.db, data.contributor.sub, row.intentId,
      input, { confirmation: pwConfirmation(row) });
    expect(result.event?.state).toBe("active");
    const response = await request(`/api/v1/workspaces/${data.workspaceId}/signal-facets/personal/cities/${input.target.citySlug}`,
      data.contributor.sub);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ heads: [expect.objectContaining({ state: "active", basket: "pertinent" })] });
  });
});
