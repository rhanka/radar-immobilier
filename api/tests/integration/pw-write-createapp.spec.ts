import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { confirmPwSignalWrite } from "../../src/services/facets/pw-write-confirm.js";
import { httpFixture } from "./base-api-http-fixture.js";

describeDb("PW-D createApp wiring", () => {
  it("should mount no write-intent route and persist BASE on the app database", async () => {
    const { data, request } = await httpFixture();
    const input = await preparedSelect(data);
    const row = await pwPrepared(data, input);
    const missing = await request(`/api/v1/artifacts/write-intents/${row.intentId}/confirm`,
      data.contributor.sub, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: "x" }) });
    expect([404, 405]).toContain(missing.status);
    const result = await confirmPwSignalWrite(data.db, data.contributor.sub, row.intentId,
      input, { confirmation: pwConfirmation(row) });
    expect(result.event?.state).toBe("active");
    const response = await request(`/api/v1/workspaces/${data.workspaceId}/signal-facets/personal/cities/${input.target.citySlug}`,
      data.contributor.sub);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ heads: [expect.objectContaining({ state: "active", basket: "pertinent" })] });
  });
});
