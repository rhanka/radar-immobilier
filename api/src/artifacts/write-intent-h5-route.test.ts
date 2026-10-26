// PW-A PWA-07: H5 receiver stays closed without deps and has no command path.
import { describe, expect, it } from "vitest";
import { writeIntentH5Route } from "./write-intent-h5-route.js";

describe("h5 write receiver", () => {
  it("should stay closed without authority and refuse command methods", async () => {
    const app = writeIntentH5Route(null);
    expect((await app.request("/write-intents/prepare", { method: "POST" })).status).toBe(503);
    expect((await app.request("/write-intents/prepare", { method: "GET" })).status).toBe(405);
    expect((await app.request("/write-intents/some-id", { method: "POST" })).status).toBe(405);
  });
});
