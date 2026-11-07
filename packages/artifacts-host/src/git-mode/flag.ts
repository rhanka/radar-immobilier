/**
 * Git-backed artifact mode (A-LIVE v2, design D0): the feature flag and the
 * tool selection it gates.
 *
 * `IMMO_ARTIFACTS_GIT_MODE` is OFF by default. Unset, empty or `off` leaves
 * the served catalogue, the compiled profile and every tool definition
 * byte-identical to the flag-less build. The stages are cumulative and follow
 * the enablement milestones:
 *
 * - `bindings` (M2-I): git_attach, fetch_app_source;
 * - `build` (M3-I): plus git_publish (sandbox executor, SG4b handoff);
 * - `live` (M4-I): plus git_commit and the five live_* tools.
 *
 * A stage is admitted only when the pinned provider routes its anchor tool
 * through `createHttpArtifactApp` (see GIT_TOOL_PROVIDER_ROUTING). Any other
 * combination refuses at boot: the flag can never expose a tool the provider
 * would answer with `unsupported artifacts transport capability`.
 */

export const ARTIFACTS_GIT_MODE_ENV = "IMMO_ARTIFACTS_GIT_MODE" as const;

export const GIT_MODE_STAGES = ["off", "bindings", "build", "live"] as const;
export type GitModeStage = (typeof GIT_MODE_STAGES)[number];

/** M2-I: binding and source reads. */
export const GIT_BINDING_TOOLS = ["artifacts_git_attach", "artifacts_fetch_app_source"] as const;
/**
 * `artifacts_list_app_sources` is deliberately absent: no provider routes it
 * (0.2.19 included), so it is never selected, scoped or served.
 */
/** M3-I: server-side build and publication of a bound commit. */
export const GIT_BUILD_TOOLS = ["artifacts_git_publish"] as const;
/** M4-I: live drafts on the builder pod and the commit of the live draft. */
export const GIT_LIVE_TOOLS = ["artifacts_git_commit", "artifacts_live_write", "artifacts_live_read",
  "artifacts_live_reset", "artifacts_live_status", "artifacts_live_control"] as const;
export const GIT_ARTIFACT_TOOLS = [...GIT_BINDING_TOOLS, ...GIT_BUILD_TOOLS, ...GIT_LIVE_TOOLS] as const;
export type GitArtifactTool = (typeof GIT_ARTIFACT_TOOLS)[number];

const STAGE_TOOLS: Readonly<Record<GitModeStage, readonly GitArtifactTool[]>> = Object.freeze({
  off: [],
  bindings: [...GIT_BINDING_TOOLS],
  build: [...GIT_BINDING_TOOLS, ...GIT_BUILD_TOOLS],
  live: [...GIT_BINDING_TOOLS, ...GIT_BUILD_TOOLS, ...GIT_LIVE_TOOLS],
});

/** The tools a stage cannot run without (one per milestone it includes). */
const STAGE_ANCHORS: Readonly<Record<GitModeStage, readonly GitArtifactTool[]>> = Object.freeze({
  off: [],
  bindings: ["artifacts_git_attach"],
  build: ["artifacts_git_attach", "artifacts_git_publish"],
  live: ["artifacts_git_attach", "artifacts_git_publish", "artifacts_live_write", "artifacts_git_commit"],
});

/**
 * Provider versions whose `createHttpArtifactApp` routes each git tool.
 *
 * - git_commit and live_* ride `deps.live` since 0.2.18.
 * - fetch_app_source, git_attach and git_publish are routed by 0.2.19
 *   (`deps.gitTools`, M1). TODO(0.2.19): add "0.2.19" to these three entries
 *   (and to the live entries) in the pin PR, after qualification. Until then
 *   the list stays empty, so the `bindings`, `build` and `live` stages refuse
 *   at boot (fail-closed default).
 * - A stage tool missing from a provider's routing is dropped from the
 *   selection and reported as `unrouted`; a missing anchor refuses the stage.
 */
export const GIT_TOOL_PROVIDER_ROUTING: Readonly<Record<GitArtifactTool, readonly string[]>> = Object.freeze({
  artifacts_git_attach: [],
  artifacts_fetch_app_source: [],
  artifacts_git_publish: [],
  artifacts_git_commit: ["0.2.18"],
  artifacts_live_write: ["0.2.18"],
  artifacts_live_read: ["0.2.18"],
  artifacts_live_reset: ["0.2.18"],
  artifacts_live_status: ["0.2.18"],
  artifacts_live_control: ["0.2.18"],
});

export interface GitModeResolution {
  readonly stage: GitModeStage;
  /** Tools selected in the profile and served; empty when the flag is off. */
  readonly tools: readonly GitArtifactTool[];
  /** Stage tools the pinned provider does not route; never selected. */
  readonly unrouted: readonly GitArtifactTool[];
}

export const GIT_MODE_OFF: GitModeResolution = Object.freeze({ stage: "off", tools: Object.freeze([]), unrouted: Object.freeze([]) });

/** Strict parse: anything other than unset, empty or a known stage is a configuration error. */
export function readGitModeStage(env: NodeJS.ProcessEnv): GitModeStage {
  const raw = env[ARTIFACTS_GIT_MODE_ENV]?.trim();
  if (raw === undefined || raw === "") return "off";
  if ((GIT_MODE_STAGES as readonly string[]).includes(raw)) return raw as GitModeStage;
  throw new Error("artifact_git_mode_invalid");
}

export function resolveGitMode(env: NodeJS.ProcessEnv, providerVersion: string,
  routing: Readonly<Record<GitArtifactTool, readonly string[]>> = GIT_TOOL_PROVIDER_ROUTING): GitModeResolution {
  const stage = readGitModeStage(env);
  if (stage === "off") return GIT_MODE_OFF;
  const routed = (tool: GitArtifactTool) => routing[tool].includes(providerVersion);
  if (STAGE_ANCHORS[stage].some((tool) => !routed(tool))) throw new Error("artifact_git_mode_provider_unqualified");
  return Object.freeze({ stage,
    tools: Object.freeze(STAGE_TOOLS[stage].filter(routed)),
    unrouted: Object.freeze(STAGE_TOOLS[stage].filter((tool) => !routed(tool))) });
}

export function isGitArtifactTool(name: string): name is GitArtifactTool {
  return (GIT_ARTIFACT_TOOLS as readonly string[]).includes(name);
}

/** Read-only git tools; every other git tool is a write (immo:artifacts:write). */
export const GIT_READ_TOOLS: readonly GitArtifactTool[] = Object.freeze(["artifacts_fetch_app_source",
  "artifacts_live_read", "artifacts_live_status"]);

/**
 * Provider operation entries for the selected git tools. Limits mirror the
 * provider defaults: principal keys at 256 UTF-16 units, commit messages at
 * 16384 (`live-commit.ts`). Reads carry no limits.
 */
export function gitProfileOperations(tools: readonly GitArtifactTool[]) {
  return tools.map((tool) => {
    const operation = tool.slice("artifacts_".length);
    if (GIT_READ_TOOLS.includes(tool)) return { operation, limits: {}, defaults: {} };
    return { operation, limits: operation === "git_commit"
      ? { idempotencyKeyMaxUnits: 256, gitMessageMaxUnits: 16384 } : { idempotencyKeyMaxUnits: 256 }, defaults: {} };
  });
}
