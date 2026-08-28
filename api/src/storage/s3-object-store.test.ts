import { describe, expect, it } from "vitest";
import { S3ObjectReader, S3ObjectStore } from "./s3-object-store.js";

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

describe("reading bytes and their version together", () => {
  it("takes the ETag from the same GET that returned the bytes", async () => {
    // One round trip, one version: a second HEAD could report a version the
    // returned bytes never had.
    const sent: unknown[] = [];
    const client = {
      send: async (input: unknown) => {
        sent.push(input);
        return {
          ETag: '"v1"',
          Body: { transformToByteArray: async () => new Uint8Array([7, 8]) },
        };
      },
    };
    const store = new S3ObjectStore(client as never, "bucket");

    const read = await store.getWithEtag("graph/sutton/latest.json");

    expect(read).toEqual({
      key: "graph/sutton/latest.json",
      body: new Uint8Array([7, 8]),
      etag: '"v1"',
    });
    expect(sent).toHaveLength(1);
    expect((sent[0] as { constructor: { name: string } }).constructor.name)
      .toBe("GetObjectCommand");
  });

  it("reports an absent object as null rather than as a failure", async () => {
    const missing = Object.assign(new Error("nope"), { name: "NoSuchKey" });
    const client = { send: async () => { throw missing; } };
    const store = new S3ObjectStore(client as never, "bucket");

    expect(await store.getWithEtag("graph/nowhere/latest.json")).toBeNull();
  });

  it("propagates any other read failure instead of pretending the key is absent", async () => {
    const client = {
      send: async () => { throw Object.assign(new Error("boom"), { name: "AccessDenied" }); },
    };
    const store = new S3ObjectStore(client as never, "bucket");

    await expect(store.getWithEtag("graph/sutton/latest.json")).rejects.toThrow("boom");
  });
});

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

describe("S3ObjectReader — read-only geo document capability", () => {
  it("exposes ONLY get/head and issues only GET/HEAD commands (no write/list/create API)", async () => {
    const sent: string[] = [];
    const client = {
      send: async (input: unknown) => {
        const name = (input as { constructor: { name: string } }).constructor.name;
        sent.push(name);
        return name === "GetObjectCommand"
          ? { Body: { transformToByteArray: async () => new Uint8Array([1, 2]) } }
          : { ContentType: "application/pdf", ContentLength: 2, ETag: '"v1"' };
      },
    };
    const reader = new S3ObjectReader(client as never, "sentropic-geo");

    const head = await reader.head("raw/pv-index/cas/a.pdf");
    const bytes = await reader.get("raw/pv-index/cas/a.pdf");

    expect(head).toMatchObject({ contentType: "application/pdf" });
    expect(bytes).toEqual(new Uint8Array([1, 2]));
    expect(sent).toEqual(["HeadObjectCommand", "GetObjectCommand"]);
    // The type is the guarantee: no mutating/enumerating method exists.
    expect("put" in reader).toBe(false);
    expect("list" in reader).toBe(false);
    expect("ensureBucket" in reader).toBe(false);
  });

  it("head returns null for a genuinely absent object", async () => {
    const reader = new S3ObjectReader(
      {
        send: async () => {
          throw Object.assign(new Error("nope"), { name: "NotFound" });
        },
      } as never,
      "sentropic-geo",
    );

    expect(await reader.head("raw/pv-index/cas/missing.pdf")).toBeNull();
  });

  it("head PROPAGATES a real access failure instead of masking it as a 404", async () => {
    const reader = new S3ObjectReader(
      {
        send: async () => {
          throw Object.assign(new Error("denied"), { name: "AccessDenied" });
        },
      } as never,
      "sentropic-geo",
    );

    await expect(reader.head("raw/pv-index/cas/denied.pdf")).rejects.toThrow(
      "denied",
    );
  });

  it("head PROPAGATES a mistyped-bucket fault (NoSuchBucket is 404 but NOT a document miss)", async () => {
    // A NoSuchBucket (e.g. bucket `sentropic-ge0`) comes back as HTTP 404. It
    // must surface as an error, not be masked as "document_not_found" for every
    // PV — that would hide the whole cutover being broken.
    const reader = new S3ObjectReader(
      {
        send: async () => {
          throw Object.assign(new Error("no such bucket"), {
            name: "NoSuchBucket",
            $metadata: { httpStatusCode: 404 },
          });
        },
      } as never,
      "sentropic-ge0",
    );

    await expect(reader.head("raw/pv-index/cas/a.pdf")).rejects.toThrow(
      "no such bucket",
    );
  });
});
