import { describe, expect, it, vi } from "vitest";
import { createArtifactControl } from "./facade.js";

describe("publication content links", () => {
  it.each(["pages.example.test/path", "pages.example.test:443", "bad host"])(
    "refuses invalid stable origin %s before calling storage", async (contentBase) => {
      const handle = vi.fn().mockResolvedValue({ status: 201, body: {} });
      const host = { app: { handle } } as unknown as Parameters<typeof createArtifactControl>[0];
      const response = await createArtifactControl(host, "scope", contentBase).handle("publish", "alice", {
        artifactId: "123e4567-e89b-12d3-a456-426614174000", idempotencyKey: "key",
        files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
      });
      expect(response).toEqual({ status: 400, body: { error: "invalid_request" } });
      expect(handle).not.toHaveBeenCalled();
    },
  );
});
