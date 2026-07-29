import { describe, expect, it } from "vitest";
import { S3ObjectStore } from "./s3-object-store.js";

/**
 * These two tests deliberately import nothing that is new, so they run against
 * the pre-fix store as well and fail on behaviour rather than on a missing
 * module: before the guard, `put()` published `graph/<city>/latest.json`
 * unconditionally — no archive, no expected version, no way for a second
 * writer to notice it had just erased the first writer's version.
 */
function recordingClient(): { client: { send: (input: unknown) => Promise<unknown> }; sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      send: async (input: unknown) => {
        sent.push(input);
        return {};
      },
    },
  };
}

describe("canonical graph key guard on the write path", () => {
  it("refuses graph/<city>/latest.json without reaching S3 at all", async () => {
    const { client, sent } = recordingClient();
    const store = new S3ObjectStore(client as never, "bucket");

    await expect(store.put("graph/sutton/latest.json", new Uint8Array([1])))
      .rejects.toThrow(/canonical/i);
    expect(sent).toEqual([]);
  });

  it("leaves every other key writable, including the city's own history", async () => {
    const { client, sent } = recordingClient();
    const store = new S3ObjectStore(client as never, "bucket");

    await store.put("graph/sutton/history/pre-v23.json", new Uint8Array([1]));
    await store.put("graphify-34-backups/b1/graph/sutton/latest.json", new Uint8Array([1]));
    await store.put("raw/sutton/proces-verbaux/cas/abc.pdf", new Uint8Array([1]));

    expect(sent).toHaveLength(3);
  });
});
