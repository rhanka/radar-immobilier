// PW-A PWA-07: H5 receiver stays closed without deps and has no command path.
import { describe, expect, it } from "vitest";
import { writeIntentH5Route } from "./write-intent-h5-route.js";

describe("h5 write receiver", () => {
  it("should stay closed without authority and refuse command methods", async () => {
    const app = writeIntentH5Route(null);
    const closed = await app.request("/write-intents", { method: "POST" });
    expect(closed.status).toBe(503);
    expect(await closed.json()).toMatchObject({ operation: "facets.write-intents.prepare.v1",
      error: { code: "write_transport_closed", action: "contact_operator" } });
    expect(closed.headers.get("cache-control")).toBe("private, no-store");
    expect((await app.request("/write-intents", { method: "GET" })).status).toBe(405);
    expect((await app.request("/write-intents/some-id", { method: "POST" })).status).toBe(405);
  });
});
