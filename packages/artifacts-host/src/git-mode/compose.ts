import {
  createGitHubForge, createGitPort, type GitBindingStore, type GitCodeRightsPort, type GitHumanDirectory,
  type GitIdentity, type GitInstallationLeasePort, type GitPort,
} from "@sentropic/artifacts";
import { createPostgresGitBindingStore } from "@sentropic/artifacts/adapters/postgres";
import type { HttpAppDeps } from "@sentropic/artifacts/http";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type pg from "pg";
import { createGitToolAuthorize, createPostgresArtifactOwners, type ArtifactOwnerPort } from "./authority.js";
import type { GitModeResolution } from "./flag.js";
import {
  createImmoCodeRights, createStaticGitHumanDirectory, invocationHasWriteScope, parseCursorKey, parseGitHumanEntries,
  type GitHumanEntry,
} from "./identity.js";
import { createLeaseBrokerClient, FAIL_CLOSED_LEASES } from "./lease-broker.js";
import { gitToolServiceFactory, GIT_TOOLS_DEP_KEY, type GitBuildPort, type GitToolService, type GitToolsDeps } from "./provider-adapter.js";
import { createImmoGitRegistry, IMMO_GIT_OUTPUT_DIR, IMMO_GIT_REPO_ID } from "./registry.js";

/**
 * Host composition of the git mode (D0: immo composes the package locally).
 * Flag off: no dependency at all, so `createHttpArtifactApp` receives exactly
 * the flag-less deps. Flag on: `deps.git` (binding projection) and the 0.2.19
 * `gitTools` executors. A missing piece of configuration never crashes the
 * host: the matching port fails closed at call time with a typed refusal
 * (`provider_unavailable`, `git_repo_not_registered`, `access_denied`).
 *
 * Configuration (all optional, documented in docs/operator/git-artifact-mode.md):
 * IMMO_ARTIFACTS_GIT_INSTALLATION_REF, IMMO_ARTIFACTS_GIT_BROKER_ORIGIN,
 * IMMO_ARTIFACTS_GIT_BROKER_TOKEN (secret), IMMO_ARTIFACTS_GIT_CURSOR_KEY
 * (secret), IMMO_ARTIFACTS_GIT_CODE_READERS, IMMO_ARTIFACTS_GIT_HUMANS,
 * IMMO_ARTIFACTS_GIT_COMMITTER_NAME, IMMO_ARTIFACTS_GIT_COMMITTER_EMAIL.
 */
export interface GitModeConfig {
  readonly installationRef?: string | undefined;
  readonly brokerOrigin?: string | undefined;
  readonly brokerToken?: string | undefined;
  readonly cursorKey?: Uint8Array | undefined;
  readonly codeReaders: readonly string[];
  readonly humans: readonly GitHumanEntry[];
  readonly committer?: GitIdentity | undefined;
}

const optional = (value: string | undefined) => value?.trim() ? value.trim() : undefined;

export function readGitModeConfig(env: NodeJS.ProcessEnv): GitModeConfig {
  const name = optional(env.IMMO_ARTIFACTS_GIT_COMMITTER_NAME);
  const email = optional(env.IMMO_ARTIFACTS_GIT_COMMITTER_EMAIL);
  if ((name === undefined) !== (email === undefined)) throw new Error("artifact_git_committer_incomplete");
  return {
    installationRef: optional(env.IMMO_ARTIFACTS_GIT_INSTALLATION_REF),
    brokerOrigin: optional(env.IMMO_ARTIFACTS_GIT_BROKER_ORIGIN),
    brokerToken: optional(env.IMMO_ARTIFACTS_GIT_BROKER_TOKEN),
    cursorKey: parseCursorKey(env.IMMO_ARTIFACTS_GIT_CURSOR_KEY),
    codeReaders: (env.IMMO_ARTIFACTS_GIT_CODE_READERS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    humans: parseGitHumanEntries(env.IMMO_ARTIFACTS_GIT_HUMANS),
    committer: name && email ? { name, email } : undefined,
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
}

export interface GitModeDeps {
  readonly git?: NonNullable<HttpAppDeps["git"]>;
  readonly [GIT_TOOLS_DEP_KEY]?: GitToolService;
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

export function composeGitMode(input: ComposeGitModeInput): GitModeDeps {
  if (input.resolution.stage === "off") return {};
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
  const brokerToken = config.brokerToken;
  const leases = ports.leases ?? (config.brokerOrigin && brokerToken
    ? createLeaseBrokerClient({ origin: config.brokerOrigin, identity: { authorization: async () => `Bearer ${brokerToken}` },
      ...(ports.fetch ? { fetch: ports.fetch } : {}) })
    : FAIL_CLOSED_LEASES);
  const git = ports.git ?? (config.cursorKey && config.committer ? createGitPort({
    registry, leases, forge: createGitHubForge(), directory, committer: config.committer, cursorKey: config.cursorKey,
    // Current code rights on every call; writes also need the host write scope of this call.
    async authorize(target, write) {
      if (write && !hasWriteScope()) return false;
      return codeRights.canReadCode({ storageScopeId: target.storageScopeId, repoId: target.repoId, actorId: target.principalId });
    },
  }) : FAIL_CLOSED_GIT_PORT);
  const factory = ports.gitToolFactory ?? gitToolServiceFactory();
  const gitTools = withHostGitPolicy(factory({ bindings, registry, codeRights, git, outputDir: IMMO_GIT_OUTPUT_DIR,
    authorize: createGitToolAuthorize({ owners: ports.owners ?? createPostgresArtifactOwners(pool), codeRights,
      repoId: IMMO_GIT_REPO_ID, hasWriteScope }),
    ...(ports.build ? { build: ports.build } : {}) }));
  return { git: { bindings, codeRights }, [GIT_TOOLS_DEP_KEY]: gitTools };
}
