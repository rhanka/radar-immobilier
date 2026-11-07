import { createGitToolService, createMemoryGitBindingStore, type GitCodeRightsPort, type GitPort } from "@sentropic/artifacts";
import { describe, expect, it, vi } from "vitest";
import { createGitToolAuthorize } from "./authority.js";
import { composeGitMode, FAIL_CLOSED_GIT_PORT, IMMO_GIT_DEFAULT_EXECUTOR, readGitModeConfig, withHostGitPolicy,
  type GitModeConfig } from "./compose.js";
import { GIT_MODE_OFF } from "./flag.js";
import {
  createImmoCodeRights, createStaticGitHumanDirectory, invocationHasWriteScope, parseCursorKey, parseGitHumanEntries,
  withInvocationScopes,
} from "./identity.js";
import { createLeaseBrokerClient, FAIL_CLOSED_LEASES, parseBrokerLease } from "./lease-broker.js";
import { gitToolServiceFactory, type GitToolsDeps } from "./provider-adapter.js";
import { createImmoGitRegistry, IMMO_GIT_REFUSED_WRITE_PATHS, IMMO_GIT_REPO_ID } from "./registry.js";

const SCOPE = "radar-immobilier-test";
const LIVE = { stage: "bindings", tools: ["artifacts_git_attach", "artifacts_fetch_app_source"], unrouted: [] } as const;
const config: GitModeConfig = { codeReaders: ["alice"], humans: [] };
const pool = { query: vi.fn(async () => ({ rows: [] })) } as never;
const lease = { token: "ghs_test", expiresAt: "2099-01-01T00:00:00.000Z", repositoryId: "1",
  permissions: { contents: "write", metadata: "read" }, credentialVersion: "v1" };

describe("A1 registry", () => {
  it("pins the A1 entry plus the A-LIVE §3.1 refusals", async () => {
    const registry = createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst-ref" });
    const entry = await registry.get(SCOPE, IMMO_GIT_REPO_ID);
    expect(entry).toMatchObject({ locator: "rhanka/radar-immobilier", branchPrefix: "artifact/", allowedSubPaths: [""],
      canWrite: true, publicationPolicy: { personalBranchPrefix: "artifact/p/", delegatedPublication: "personal-only" } });
    expect(entry!.refusedWritePaths).toEqual(expect.arrayContaining([".npmrc", "**/.npmrc", ".yarnrc*", "**/.yarnrc*",
      "ui/dist/**", "api/**", ".github/**", "**/package*.json"]));
    expect(entry!.writablePaths).toEqual(["ui/**", "packages/radar-domain/src/**", "packages/radar-scoring/src/**",
      "packages/radar-sources/src/**"]);
    expect(IMMO_GIT_REFUSED_WRITE_PATHS).toContain("packages/immo-mcp/**");
    expect(entry!.refusedWritePaths).toContain("artifact-build/gb1-qualification.json");
  });

  it("is empty until the SG0-app enrollment gives an installation reference", async () => {
    expect(await createImmoGitRegistry({ storageScopeId: SCOPE }).get(SCOPE, IMMO_GIT_REPO_ID)).toBeUndefined();
    expect(await createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "x" }).get("other", IMMO_GIT_REPO_ID)).toBeUndefined();
  });
});

describe("SG0-app lease broker client", () => {
  it("posts exactly the broker body with the host service identity", async () => {
    const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify(lease), { status: 200 }));
    const client = createLeaseBrokerClient({ origin: "https://sentropic.example", fetch: fetcher as never,
      identity: { authorization: async () => "Bearer host-token" }, now: () => 0 });
    await expect(client.acquire({ storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID, installationRef: "inst" })).resolves
      .toEqual(lease);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://sentropic.example/api/v1/github-app/broker/lease");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer host-token");
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(["installationRef", "repoId", "storageScopeId"]);
  });

  it("fails closed on transport errors, non-200, and any lease outside one repo with contents:write + metadata:read", async () => {
    const identity = { authorization: async () => "Bearer t" };
    const input = { storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID, installationRef: "inst" };
    for (const fetcher of [async () => { throw new Error("down"); }, async () => new Response("{}", { status: 403 }),
      async () => new Response("not json", { status: 200 })]) {
      await expect(createLeaseBrokerClient({ origin: "https://s.example", fetch: fetcher as never, identity }).acquire(input))
        .rejects.toMatchObject({ kind: "provider_unavailable" });
    }
    for (const bad of [{ ...lease, permissions: { contents: "write", metadata: "read", administration: "write" } },
      { ...lease, permissions: { contents: "read", metadata: "read" } }, { ...lease, expiresAt: "1970-01-01T00:00:00Z" },
      { ...lease, token: "" }]) {
      expect(() => parseBrokerLease(bad, Date.now())).toThrow();
    }
    await expect(FAIL_CLOSED_LEASES.acquire(input)).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("refuses a non-https or path-bearing broker origin", () => {
    const identity = { authorization: async () => "Bearer t" };
    expect(() => createLeaseBrokerClient({ origin: "http://s.example", identity })).toThrow("artifact_git_broker_origin_invalid");
    expect(() => createLeaseBrokerClient({ origin: "https://s.example/x", identity })).toThrow("artifact_git_broker_origin_invalid");
  });
});

describe("per-user identity ports", () => {
  it("grants code rights to listed, approved principals only", async () => {
    const rights = createImmoCodeRights({ readers: ["alice", "bob"], repoId: IMMO_GIT_REPO_ID,
      isApproved: async (sub) => sub === "alice" });
    const ask = (actorId: string, repoId: string = IMMO_GIT_REPO_ID) => rights.canReadCode({ storageScopeId: SCOPE, repoId, actorId });
    expect(await ask("alice")).toBe(true);
    expect(await ask("bob")).toBe(false);
    expect(await ask("mallory")).toBe(false);
    expect(await ask("alice", "other-repo")).toBe(false);
  });

  it("maps one GitHub noreply identity per editing user", async () => {
    const directory = createStaticGitHumanDirectory(parseGitHumanEntries(
      JSON.stringify([{ principalId: "alice", name: "Alice", email: "123+alice@users.noreply.github.com" }])));
    expect(await directory.resolve({ storageScopeId: SCOPE, principalId: "alice" })).toEqual(
      { name: "Alice", email: "123+alice@users.noreply.github.com" });
    expect(await directory.resolve({ storageScopeId: SCOPE, principalId: "bob" })).toBeNull();
    expect(() => createStaticGitHumanDirectory([{ principalId: "x", name: "X", email: "x@example.com" }]))
      .toThrow("artifact_git_human_entry_invalid");
    expect(() => parseGitHumanEntries("{")).toThrow("artifact_git_humans_invalid");
  });

  it("parses a 32-byte cursor key and refuses a short one", () => {
    expect(parseCursorKey(undefined)).toBeUndefined();
    expect(parseCursorKey(Buffer.alloc(32, 7).toString("base64"))?.byteLength).toBe(32);
    expect(() => parseCursorKey(Buffer.alloc(16).toString("base64"))).toThrow("artifact_git_cursor_key_invalid");
  });

  it("holds the host write scope only inside a recorded MCP call", () => {
    expect(invocationHasWriteScope()).toBe(false);
    expect(withInvocationScopes(["immo:artifacts:write"], invocationHasWriteScope)).toBe(true);
    expect(withInvocationScopes(["immo:artifacts:read"], invocationHasWriteScope)).toBe(false);
  });
});

describe("git tool authority (per user, no platform owner)", () => {
  const codeRights: GitCodeRightsPort = { canReadCode: async ({ actorId }) => ["alice", "bob"].includes(actorId) };
  const owners = { ownerOf: async (_scope: string, artifactId: string) => artifactId === "a-alice" ? "alice" : undefined };
  const invocation = (actorId: string) => ({ actorId, storageScopeId: SCOPE, invocationId: "i" });
  it("lets the artifact owner write with code rights and the write scope", async () => {
    const authorize = createGitToolAuthorize({ owners, codeRights, repoId: IMMO_GIT_REPO_ID, hasWriteScope: () => true });
    expect(await authorize(invocation("alice"), "a-alice")).toEqual({ ownerId: "alice", canWrite: true });
  });
  it("refuses writes to a third party with code rights, and without the write scope", async () => {
    const authorize = createGitToolAuthorize({ owners, codeRights, repoId: IMMO_GIT_REPO_ID, hasWriteScope: () => true });
    expect(await authorize(invocation("bob"), "a-alice")).toEqual({ ownerId: "alice", canWrite: false });
    const readOnly = createGitToolAuthorize({ owners, codeRights, repoId: IMMO_GIT_REPO_ID, hasWriteScope: () => false });
    expect(await readOnly(invocation("alice"), "a-alice")).toEqual({ ownerId: "alice", canWrite: false });
    await expect(authorize(invocation("alice"), "unknown")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("git mode composition", () => {
  it("adds no dependency when the flag is off", () => {
    expect(composeGitMode({ resolution: GIT_MODE_OFF, pool, storageScopeId: SCOPE, config })).toEqual({});
  });

  it("composes deps.git and the 0.2.20 git tools with fakes, failing closed on missing configuration", async () => {
    let captured: GitToolsDeps | undefined;
    const bindings = createMemoryGitBindingStore();
    const deps = composeGitMode({ resolution: LIVE, pool, storageScopeId: SCOPE, config,
      ports: { bindings, gitToolFactory: (input) => { captured = input; return { execute: async () => ({}) }; } } });
    expect(deps.git?.bindings).toBe(bindings);
    expect(deps.gitTools).toBeDefined();
    expect(captured!.outputDir).toBe("ui/dist");
    expect(captured!.git).toBe(FAIL_CLOSED_GIT_PORT);
    expect(await captured!.registry.get(SCOPE, IMMO_GIT_REPO_ID)).toBeUndefined();
    await expect(captured!.git.resolveRef({} as never, "main")).rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(captured!.build).toBeUndefined();
  });

  it("builds a real GitPort once the cursor key, committer and broker are configured", () => {
    let git: GitPort | undefined;
    composeGitMode({ resolution: LIVE, pool, storageScopeId: SCOPE,
      config: readGitModeConfig({ IMMO_ARTIFACTS_GIT_CURSOR_KEY: Buffer.alloc(32, 1).toString("base64"),
        IMMO_ARTIFACTS_GIT_COMMITTER_NAME: "radar-immobilier artifacts",
        IMMO_ARTIFACTS_GIT_COMMITTER_EMAIL: "1+radar@users.noreply.github.com",
        IMMO_ARTIFACTS_GIT_INSTALLATION_REF: "inst", IMMO_ARTIFACTS_GIT_BROKER_ORIGIN: "https://s.example",
        IMMO_ARTIFACTS_SERVICE_OAUTH_TOKEN_ENDPOINT: "https://auth.example/api/v1/auth/oauth/token",
        IMMO_ARTIFACTS_SERVICE_OAUTH_CLIENT_ID: "immo-host", IMMO_ARTIFACTS_SERVICE_OAUTH_CLIENT_SECRET: "s" }),
      ports: { bindings: createMemoryGitBindingStore(), gitToolFactory: (input) => { git = input.git; return { execute: async () => ({}) }; } } });
    expect(git).toBeDefined();
    expect(git).not.toBe(FAIL_CLOSED_GIT_PORT);
    expect(() => readGitModeConfig({ IMMO_ARTIFACTS_GIT_COMMITTER_NAME: "x" })).toThrow("artifact_git_committer_incomplete");
  });

  it("defaults git_attach to the sandbox executor and refuses caller and ci", async () => {
    expect(IMMO_GIT_DEFAULT_EXECUTOR).toBe("sandbox");
    const seen: Record<string, unknown>[] = [];
    const service = withHostGitPolicy({ execute: async (_op, args) => { seen.push(args); return { ok: true }; } });
    const invocation = { actorId: "alice", storageScopeId: SCOPE, invocationId: "i" };
    await service.execute("git_attach", { artifactId: "a", idempotencyKey: "k" }, invocation);
    await service.execute("git_attach", { artifactId: "a", idempotencyKey: "k", executor: "sandbox" }, invocation);
    expect(seen.map((args) => args.executor)).toEqual(["sandbox", "sandbox"]);
    for (const executor of ["caller", "ci"]) {
      await expect(service.execute("git_attach", { artifactId: "a", idempotencyKey: "k", executor }, invocation))
        .rejects.toMatchObject({ kind: "builder_unavailable" });
    }
    await service.execute("fetch_app_source", { artifactId: "a" }, invocation);
    expect(seen.at(-1)).toEqual({ artifactId: "a" });
    expect(seen).toHaveLength(3);
  });

  it("applies the executor policy to the composed git tools", async () => {
    const seen: Record<string, unknown>[] = [];
    const deps = composeGitMode({ resolution: LIVE, pool, storageScopeId: SCOPE, config, ports: {
      bindings: createMemoryGitBindingStore(), gitToolFactory: () => ({ execute: async (_op, args) => { seen.push(args); return {}; } }) } });
    await deps.gitTools!.execute("git_attach", { artifactId: "a", idempotencyKey: "k" }, { actorId: "alice", storageScopeId: SCOPE, invocationId: "i" });
    expect(seen[0]).toMatchObject({ executor: "sandbox" });
  });

  it("composes the git tools with the provider createGitToolService (0.2.20), refusing a provider without it", () => {
    expect(gitToolServiceFactory()).toBe(createGitToolService);
    expect(() => gitToolServiceFactory({})).toThrow("artifact_git_tools_provider_missing");
  });
});
