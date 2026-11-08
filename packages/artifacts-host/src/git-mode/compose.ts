import {
  createGitHubForge, createGitPort, createPostgresLiveStore, type GitBindingStore, type GitCodeRightsPort, type GitHumanDirectory,
  type GitIdentity, type GitInstallationLeasePort, type GitPort, type LiveKeyPort, type LiveStore, type LiveWorkerPort,
} from "@sentropic/artifacts";
import { createPostgresGitBindingStore } from "@sentropic/artifacts/adapters/postgres";
import type { HttpAppDeps } from "@sentropic/artifacts/http";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type pg from "pg";
import { createGitToolAuthorize, createPostgresArtifactOwners, type ArtifactOwnerPort } from "./authority.js";
import { GIT_LIVE_TOOLS, type GitModeResolution } from "./flag.js";
import {
  createImmoCodeRights, createStaticGitHumanDirectory, invocationHasWriteScope, parseCursorKey, parseGitHumanEntries,
  type GitHumanEntry,
} from "./identity.js";
import { createLeaseBrokerClient, FAIL_CLOSED_LEASES } from "./lease-broker.js";
import { createHostBuildApiClient, type HostBuildJobStore } from "./build-api.js";
import { createSealedLiveKeys, parseLiveDraftKeyring, type LiveDraftKeyring } from "./live-keys.js";
import { SERVICE_SCOPE_BROKER, SERVICE_SCOPE_BUILDER, serviceTokenSource, type ServiceTokenConfig } from "./service-token.js";
import { composeLiveService, liveStoreFences } from "./live.js";
import { createLiveWorkerClient } from "./live-grant.js";
import { createPostgresHostJobStore } from "./host-jobs.js";
import {
  createLiveSessionStatePort, createPostgresLiveInvitationStore, createPostgresLiveSessions, type LiveInvitationStore, type LiveSessionPort,
} from "./live-authority.js";
import { gitToolServiceFactory, GIT_TOOLS_DEP_KEY, type GitBuildPort, type GitToolService, type GitToolsDeps } from "./provider-adapter.js";
import { createImmoGitRegistry, IMMO_GIT_OUTPUT_DIR, IMMO_GIT_REPO_ID } from "./registry.js";

/**
 * Host composition of the git mode (D0: immo composes the package locally).
 * Flag off: no dependency at all, so `createHttpArtifactApp` receives exactly
 * the flag-less deps. Flag on: `deps.git` (binding projection) and the 0.2.20
 * `gitTools` executors. A missing piece of configuration never crashes the
 * host: the matching port fails closed at call time with a typed refusal
 * (`provider_unavailable`, `git_repo_not_registered`, `access_denied`).
 *
 * Configuration (all optional, read only when the flag is on; the exact list
 * and formats are in docs/operator/git-artifact-mode.md): the OAuth service
 * client (IMMO_ARTIFACTS_SERVICE_OAUTH_*), the SG0-app broker and installation
 * (IMMO_ARTIFACTS_GIT_BROKER_ORIGIN, IMMO_ARTIFACTS_GIT_INSTALLATION_REF), the
 * GitPort (IMMO_ARTIFACTS_GIT_CURSOR_KEY, _COMMITTER_*, _CODE_READERS, _HUMANS),
 * the builder (IMMO_ARTIFACTS_BUILDER_URL) and the live draft keys
 * (IMMO_ARTIFACTS_LIVE_DRAFT_KEYS, IMMO_ARTIFACTS_LIVE_DRAFT_KEY_CURRENT).
 */
export interface GitModeConfig {
  readonly installationRef?: string | undefined;
  readonly brokerOrigin?: string | undefined;
  /** OAuth client_credentials service client (scopes github-app:broker and artifacts:builder). */
  readonly service?: ServiceTokenConfig | undefined;
  readonly cursorKey?: Uint8Array | undefined;
  readonly codeReaders: readonly string[];
  readonly humans: readonly GitHumanEntry[];
  readonly committer?: GitIdentity | undefined;
  /** M3-I: Sentropic builder service base URL; absent keeps git_publish closed. */
  readonly builderUrl?: string | undefined;
  /** M4-I: sealed live draft master keys (version -> 32 bytes) and the current version. */
  readonly liveDraftKeys?: LiveDraftKeyring | undefined;
  /**
   * W9 live edge (IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=1, default off), on top of
   * stage `live`: composes the controller LiveWorkerPort (reconcile/stop).
   * Off: the live service keeps its no-worker composition, byte for byte.
   */
  readonly liveEdgeEnabled?: boolean | undefined;
  /**
   * Worker qualification (IMMO_ARTIFACTS_LIVE_QUALIFIED=true, default false):
   * live_write / live_control(start) answer builder_unavailable while false.
   * Turned on by an ops change ONLY after an owner-recorded « GB4 GO preprod ».
   */
  readonly liveQualified?: boolean | undefined;
  /**
   * Invited live readers (IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED=true,
   * default false), independent of the worker qualification and under the
   * same rule. False: no invitation is created, every invitee is refused.
   */
  readonly liveInvitationsQualified?: boolean | undefined;
}

const optional = (value: string | undefined) => value?.trim() ? value.trim() : undefined;

export function readGitModeConfig(env: NodeJS.ProcessEnv): GitModeConfig {
  const name = optional(env.IMMO_ARTIFACTS_GIT_COMMITTER_NAME);
  const email = optional(env.IMMO_ARTIFACTS_GIT_COMMITTER_EMAIL);
  if ((name === undefined) !== (email === undefined)) throw new Error("artifact_git_committer_incomplete");
  return {
    installationRef: optional(env.IMMO_ARTIFACTS_GIT_INSTALLATION_REF),
    brokerOrigin: optional(env.IMMO_ARTIFACTS_GIT_BROKER_ORIGIN),
    service: { tokenEndpoint: optional(env.IMMO_ARTIFACTS_SERVICE_OAUTH_TOKEN_ENDPOINT),
      clientId: optional(env.IMMO_ARTIFACTS_SERVICE_OAUTH_CLIENT_ID),
      clientSecret: optional(env.IMMO_ARTIFACTS_SERVICE_OAUTH_CLIENT_SECRET),
      resource: optional(env.IMMO_ARTIFACTS_SERVICE_OAUTH_RESOURCE) },
    cursorKey: parseCursorKey(env.IMMO_ARTIFACTS_GIT_CURSOR_KEY),
    codeReaders: (env.IMMO_ARTIFACTS_GIT_CODE_READERS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    humans: parseGitHumanEntries(env.IMMO_ARTIFACTS_GIT_HUMANS),
    committer: name && email ? { name, email } : undefined,
    builderUrl: optional(env.IMMO_ARTIFACTS_BUILDER_URL),
    liveDraftKeys: parseLiveDraftKeyring(env.IMMO_ARTIFACTS_LIVE_DRAFT_KEYS, env.IMMO_ARTIFACTS_LIVE_DRAFT_KEY_CURRENT),
    liveEdgeEnabled: env.IMMO_ARTIFACTS_LIVE_EDGE_ENABLED?.trim() === "1",
    liveQualified: env.IMMO_ARTIFACTS_LIVE_QUALIFIED?.trim() === "true",
    liveInvitationsQualified: env.IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED?.trim() === "true",
  };
}

/** Injectable ports; production leaves them absent. */
export interface GitModePorts {
  readonly bindings?: GitBindingStore;
  readonly codeRights?: GitCodeRightsPort;
  readonly directory?: GitHumanDirectory;
  readonly leases?: GitInstallationLeasePort;
  readonly owners?: ArtifactOwnerPort;
  readonly git?: GitPort;
  readonly fetch?: typeof fetch;
  readonly hasWriteScope?: () => boolean;
  readonly gitToolFactory?: (deps: GitToolsDeps) => GitToolService;
  /** M3-I: sandbox build executor (host build API client). Absent: git_publish refuses. */
  readonly build?: GitBuildPort;
  /** M3-I: host job store; absent: the fail-closed store (git_publish refuses). */
  readonly jobs?: HostBuildJobStore;
  /** M4-I: live ports; absent ones default to Postgres stores and fail-closed keys, no worker. */
  readonly liveStore?: LiveStore;
  readonly liveKeys?: LiveKeyPort;
  readonly liveWorker?: LiveWorkerPort;
  readonly invitations?: LiveInvitationStore;
  readonly sessions?: LiveSessionPort;
  readonly liveQualified?: () => boolean;
}

export interface GitModeDeps {
  readonly git?: NonNullable<HttpAppDeps["git"]>;
  readonly [GIT_TOOLS_DEP_KEY]?: GitToolService;
  readonly live?: NonNullable<HttpAppDeps["live"]>;
}

const unavailable = (): never => { throw new ArtifactOperationError("provider_unavailable"); };

/**
 * Host executor policy: immo builds only on the Sentropic sandbox builder
 * (owner criterion: everything through the MCP, no local build). The
 * provider defaults an omitted git_attach executor to `caller`; immo defaults
 * it to `sandbox` and refuses `caller` and `ci` before any binding write.
 */
export const IMMO_GIT_DEFAULT_EXECUTOR = "sandbox" as const;

export function withHostGitPolicy(service: GitToolService): GitToolService {
  return {
    async execute(operation, args, invocation) {
      if (operation !== "git_attach") return service.execute(operation, args, invocation);
      const executor = args.executor ?? IMMO_GIT_DEFAULT_EXECUTOR;
      if (executor !== IMMO_GIT_DEFAULT_EXECUTOR) {
        throw new ArtifactOperationError("builder_unavailable", { publicDetails: { executor, reason: "executor_unavailable" } });
      }
      return service.execute(operation, { ...args, executor }, invocation);
    },
  };
}

/** GitPort used while the cursor key or committer is not configured: every call refuses. */
export const FAIL_CLOSED_GIT_PORT: GitPort = Object.freeze({
  resolveRef: async () => unavailable(), inspectCommit: async () => unavailable(), read: async () => unavailable(),
  commit: async () => unavailable(), isAncestor: async () => unavailable(), createBranch: async () => unavailable(),
});

export interface ComposeGitModeInput {
  readonly resolution: GitModeResolution;
  readonly pool: pg.Pool;
  readonly storageScopeId: string;
  readonly config: GitModeConfig;
  readonly ports?: GitModePorts;
}

/**
 * Host entry point. Flag off: returns no dependency WITHOUT reading the git
 * configuration, so a malformed or incomplete IMMO_ARTIFACTS_GIT_* value can
 * never stop radar-api or immo-mcp while the mode is off.
 */
export function composeGitModeFromEnv(input: Omit<ComposeGitModeInput, "config"> & {
  readonly env: NodeJS.ProcessEnv; readonly config?: GitModeConfig | undefined;
}): GitModeDeps {
  if (input.resolution.stage === "off") return {};
  const { env, config, ...rest } = input;
  return composeGitMode({ ...rest, config: config ?? readGitModeConfig(env) });
}

/**
 * Git access shared by the git tools, the live service and the SG4b host
 * ledger: binding store, code rights, A1 registry, human directory, leases
 * and the GitPort (fail-closed pieces when the configuration is incomplete).
 */
export function composeGitAccess(input: { readonly pool: pg.Pool; readonly storageScopeId: string;
  readonly config: GitModeConfig; readonly ports?: GitModePorts }) {
  const { pool, storageScopeId, config } = input;
  const ports = input.ports ?? {};
  const hasWriteScope = ports.hasWriteScope ?? invocationHasWriteScope;
  const bindings = ports.bindings ?? createPostgresGitBindingStore(pool);
  const codeRights = ports.codeRights ?? createImmoCodeRights({ readers: config.codeReaders, repoId: IMMO_GIT_REPO_ID,
    async isApproved(principalId) {
      const result = await pool.query<{ status: string }>("SELECT status FROM account_users WHERE sub = $1", [principalId]);
      return result.rows[0]?.status === "approved";
    } });
  const registry = createImmoGitRegistry({ storageScopeId, installationRef: config.installationRef });
  const directory = ports.directory ?? createStaticGitHumanDirectory(config.humans);
  const leases = ports.leases ?? (config.brokerOrigin
    ? createLeaseBrokerClient({ origin: config.brokerOrigin,
      identity: serviceTokenSource(config.service ?? {}, SERVICE_SCOPE_BROKER, ports.fetch), ...(ports.fetch ? { fetch: ports.fetch } : {}) })
    : FAIL_CLOSED_LEASES);
  const git = ports.git ?? (config.cursorKey && config.committer ? createGitPort({
    registry, leases, forge: createGitHubForge(), directory, committer: config.committer, cursorKey: config.cursorKey,
    // Current code rights on every call; writes also need the host write scope of this call.
    async authorize(target, write) {
      if (write && !hasWriteScope()) return false;
      return codeRights.canReadCode({ storageScopeId: target.storageScopeId, repoId: target.repoId, actorId: target.principalId });
    },
  }) : FAIL_CLOSED_GIT_PORT);
  return { ports, hasWriteScope, bindings, codeRights, registry, directory, leases, git };
}

export function composeGitMode(input: ComposeGitModeInput): GitModeDeps {
  if (input.resolution.stage === "off") return {};
  const { pool, storageScopeId, config } = input;
  const { ports, hasWriteScope, bindings, codeRights, registry, directory, git } = composeGitAccess(input);
  // M3-I: git_publish is selected only from the `build` stage; the sandbox
  // executor is admitted only once the builder base URL is set; the service
  // token source itself fails closed while the OAuth client is unconfigured.
  const build = ports.build ?? (input.resolution.tools.includes("artifacts_git_publish")
    ? createHostBuildApiClient({ baseUrl: config.builderUrl,
      identity: serviceTokenSource(config.service ?? {}, SERVICE_SCOPE_BUILDER, ports.fetch),
      jobs: ports.jobs ?? createPostgresHostJobStore({ pool, scopeId: storageScopeId }),
      ...(ports.fetch ? { fetch: ports.fetch } : {}) })
    : undefined);
  const factory = ports.gitToolFactory ?? gitToolServiceFactory();
  const gitTools = withHostGitPolicy(factory({ bindings, registry, codeRights, git, outputDir: IMMO_GIT_OUTPUT_DIR,
    authorize: createGitToolAuthorize({ owners: ports.owners ?? createPostgresArtifactOwners(pool), codeRights,
      repoId: IMMO_GIT_REPO_ID, hasWriteScope }),
    ...(build ? { build } : {}) }));
  const liveSelected = input.resolution.tools.some((tool) => (GIT_LIVE_TOOLS as readonly string[]).includes(tool));
  // W9 edge flag on top of stage `live`: the store is shared with the worker
  // client (it reads the package fences sent to the controller). Flag off:
  // no worker, as before (live_write / live_control(start) answer builder_unavailable).
  const edgeWorker = liveSelected && input.resolution.stage === "live" && config.liveEdgeEnabled === true;
  const liveStore = ports.liveStore ?? (edgeWorker && !ports.liveWorker ? createPostgresLiveStore(pool) : undefined);
  const invitationsQualified = () => config.liveInvitationsQualified === true;
  const invitations = liveSelected ? ports.invitations ?? createPostgresLiveInvitationStore(pool) : undefined;
  const sessionState = invitations ? createLiveSessionStatePort(invitations, invitationsQualified) : undefined;
  const liveWorker = ports.liveWorker ?? (edgeWorker ? createLiveWorkerClient({ baseUrl: config.builderUrl,
    identity: serviceTokenSource(config.service ?? {}, SERVICE_SCOPE_BUILDER, ports.fetch), fences: liveStoreFences(liveStore!),
    sessionState: (identity, liveSessionId) => sessionState!.current(identity.storageScopeId, identity.artifactId,
      identity.bindingGeneration, liveSessionId),
    ...(ports.fetch ? { fetch: ports.fetch } : {}) }) : undefined);
  // Qualification flags (default false), read from the configuration; an injected port wins (tests).
  const qualified = ports.liveQualified ?? (() => config.liveQualified === true);
  const live = liveSelected ? composeLiveService({ pool, git, bindings, registry, codeRights, directory, hasWriteScope,
    invitations: invitations!, invitationsQualified,
    sessions: ports.sessions ?? createPostgresLiveSessions(pool),
    ...(liveStore ? { store: liveStore } : {}),
    ...(ports.liveKeys ?? config.liveDraftKeys ? { keys: ports.liveKeys ?? createSealedLiveKeys(config.liveDraftKeys!) } : {}),
    ...(liveWorker ? { worker: liveWorker } : {}), qualified })
    : undefined;
  return { git: { bindings, codeRights }, [GIT_TOOLS_DEP_KEY]: gitTools, ...(live ? { live } : {}) };
}
