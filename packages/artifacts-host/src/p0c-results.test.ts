import { describe, expect, it } from "vitest";
import { compileHostArtifactProfile } from "./p0b-profile.js";
import { createArtifactControl } from "./facade.js";
import { controlTestHost } from "./control-test-host.js";

describe("admitted artifact result projection", () => {
  it("should keep an in-flight v1 response while a new binding selects v2", async () => {
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => { resume = resolve; });
    const app = controlTestHost(async () => { await waiting; return { status: 201, body: { artifactId: "draft" } }; });
    const host = { ...app, profile: compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.cas.v2", requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 1 }) };
    const v1 = createArtifactControl(host, "scope");
    const inFlight = v1.handle("ensure", "alice", { bindingName: "draft", idempotencyKey: "one" });
    host.profile = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.v2", requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 2 });
    const v2 = createArtifactControl(host, "scope");
    resume();
    expect((await inFlight).body).toEqual({ artifactId: "draft" });
    expect((await v2.handle("ensure", "alice", { bindingName: "draft", idempotencyKey: "two" })).body)
      .toMatchObject({ ok: true, commitState: "committed", replayed: false, output: { artifactId: "draft" } });
    expect(await v2.handle("publish", "alice", null)).toMatchObject({ status: 400, body: {
      ok: false, commitState: "not_committed", error: { code: "invalid_request", retriable: false } } });
  });
});
