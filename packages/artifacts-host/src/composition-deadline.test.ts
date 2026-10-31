import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import { composeArtifactHost } from "./composition.js";
import { mapHostError } from "./host-outcome.js";
import { blob, startS3, stubConfig, stubPool, thirdAttemptOnly } from "./s3-stub.test-support.js";

vi.mock("./storage.js", () => ({
  initializeArtifactScope: vi.fn().mockResolvedValue(undefined),
}));

// The composed dispatch wraps the domain: replace the domain by one that runs a
// publish's blob sequence, and scale the publish deadline down to 2 s.
vi.mock("./commit-domain.js", async (original) => {
  const actual = await original<typeof import("./commit-domain.js")>();
  type Blobs = { putBlob(key: string, bytes: Uint8Array): Promise<void>; getBlob(key: string): Promise<Uint8Array | undefined> };
  return {
    ...actual,
    PUBLISH_BLOB_DEADLINE_MS: 2000,
    createCommitDomain: vi.fn(async ({ blobs }: { blobs: Blobs }) => {
      const execute = async (request: { path: string; body: { files: number } }, invocation: { invocationId: string }) => {
        try {
          const files = Array.from({ length: request.body.files }, (_, index) => blob(`<p>file ${index}</p>`));
          for (const file of files) await blobs.putBlob(file.key, file.bytes);
          for (const file of files) await blobs.getBlob(file.key);
          return { ok: true, value: { status: 201, body: {} } };
        } catch (cause) {
          return { ok: false, failure: classifyArtifactFailure(cause, { invocationId: invocation.invocationId,
            operation: request.path.slice(1), phase: "dispatch", commitState: "not_committed" }, mapHostError) };
        }
      };
      return { app: { execute, handle: execute, selectedCapabilities: [], profileDigest: "test" },
        execute, store: {}, publication: {} };
    }),
  };
});

const FAST_BUDGET = { attemptTimeoutMs: 300, maxAttempts: 3, operationTimeoutMs: 1500 };
type Dispatch = (request: unknown, invocation: unknown) => Promise<{ ok: boolean; failure?: unknown }>;

describe("composed dispatch deadline", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("keeps the publish blob deadline strictly inside the preparation window", async () => {
    const actual = await vi.importActual<typeof import("./commit-domain.js")>("./commit-domain.js");
    expect(actual.PUBLISH_FINALIZE_MARGIN_MS).toBeGreaterThan(0);
    expect(actual.PUBLISH_BLOB_DEADLINE_MS + actual.PUBLISH_FINALIZE_MARGIN_MS).toBe(actual.PREPARATION_WINDOW_MS);
  });

  it.each([
    ["/publish", "ends at the publish deadline with a retriable 503", false],
    ["/ensure", "leaves another write to its per-operation budgets", true],
  ] as const)("%s %s", async (path, _title, succeeds) => {
    const s3 = await startS3({ stalled: thirdAttemptOnly, close: true });
    const host = await composeArtifactHost(stubPool(), stubConfig(s3.url, { s3Budget: FAST_BUDGET }));
    try {
      const started = Date.now();
      // 2 files = 4 blob operations of >= 600 ms each: > 2 s in total.
      const outcome = await (host.execute as unknown as Dispatch)({ method: "POST", path, body: { files: 2 } },
        { invocationId: randomUUID(), actorId: "alice", storageScopeId: "scope" });
      const elapsed = Date.now() - started;
      if (succeeds) {
        expect(outcome.ok).toBe(true);
        expect(elapsed).toBeGreaterThan(2000);
      } else {
        expect(outcome.ok).toBe(false);
        expect(outcome.failure).toMatchObject({ category: "provider_unavailable", httpStatus: 503, retriable: true });
        expect(elapsed).toBeGreaterThanOrEqual(1950);
        expect(elapsed).toBeLessThan(2250);
      }
    } finally {
      host.close();
      await s3.close();
    }
  }, 30_000);
});
