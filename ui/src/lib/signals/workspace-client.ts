/**
 * 6H workspace context: the explicit workspace every scoped signal read and
 * command carries.
 *
 * Resolution is done once per login incarnation from
 * `GET /api/v1/workspaces` (session cookie, no query string):
 * - exactly one active membership selects that workspace;
 * - zero memberships leave the context `missing` and no scoped request is
 *   issued (signal screens show their workspace-unavailable state);
 * - several memberships require an explicit user pick (`choose`): no
 *   workspace is ever defaulted or inferred.
 *
 * Every (re)load mints a fresh `viewerKey` object, so late responses from a
 * previous login incarnation are discarded by `isLiveScopedContext`. A
 * workspace switch keeps the viewer incarnation but changes `workspaceId`,
 * which also invalidates in-flight scoped reads.
 */

import { writable, type Readable } from "svelte/store";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchJsonWithTimeout,
  readJsonErrorCode,
} from "$lib/net/fetch-with-timeout.js";
import {
  emptyScopedViewerContext,
  type ScopedViewerContext,
} from "./signal-facet-scope.js";

export const WORKSPACES_PATH = "/api/v1/workspaces";

/** One workspace the caller is an active member of. */
export interface WorkspaceOption {
  id: string;
  slug: string;
  label: string;
  moderateArchive: boolean;
  manageMembers: boolean;
}

export class WorkspaceClientError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = "WorkspaceClientError";
    this.status = status;
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict parse of the `GET /api/v1/workspaces` body. Any malformed row
 * refuses the whole payload: a partially readable list never selects a
 * workspace.
 */
export function parseWorkspacesResponse(body: unknown): WorkspaceOption[] {
  if (!isRecord(body) || body.ok !== true || !Array.isArray(body.workspaces)) {
    throw new WorkspaceClientError("invalid_workspaces_response");
  }
  const seen = new Set<string>();
  return body.workspaces.map((row) => {
    if (!isRecord(row) || !isRecord(row.workspace)) {
      throw new WorkspaceClientError("invalid_workspaces_response");
    }
    const { id, slug, label } = row.workspace;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)
      || typeof slug !== "string" || slug.length === 0
      || typeof label !== "string" || label.length === 0
      || typeof row.moderateArchive !== "boolean"
      || typeof row.manageMembers !== "boolean") {
      throw new WorkspaceClientError("invalid_workspaces_response");
    }
    const normalized = id.toLowerCase();
    if (seen.has(normalized)) throw new WorkspaceClientError("invalid_workspaces_response");
    seen.add(normalized);
    return { id: normalized, slug, label,
      moderateArchive: row.moderateArchive, manageMembers: row.manageMembers };
  });
}

export interface WorkspaceRequestOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** `GET /api/v1/workspaces`: the caller's active workspace memberships. */
export async function fetchWorkspaces(
  opts: WorkspaceRequestOptions = {},
): Promise<WorkspaceOption[]> {
  const res = await fetchJsonWithTimeout<unknown>(`${opts.baseUrl ?? ""}${WORKSPACES_PATH}`, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    init: { cache: "no-store" },
  });
  if (!res.ok) {
    throw new WorkspaceClientError(`workspaces: ${res.status}`, res.status, readJsonErrorCode(res.json));
  }
  return parseWorkspacesResponse(res.json);
}

export type WorkspaceSelection =
  | { status: "ready"; workspaceId: string }
  | { status: "missing" }
  | { status: "choose" };

/**
 * 0 → missing, 1 → that workspace, N → the explicit pick when it is one of
 * the listed workspaces, otherwise `choose`. Never a default.
 */
export function resolveWorkspaceSelection(
  options: readonly WorkspaceOption[], picked: string | null = null,
): WorkspaceSelection {
  if (options.length === 0) return { status: "missing" };
  if (options.length === 1) return { status: "ready", workspaceId: options[0]!.id };
  const match = picked === null ? undefined
    : options.find((option) => option.id === picked.toLowerCase());
  return match ? { status: "ready", workspaceId: match.id } : { status: "choose" };
}

export type WorkspaceContextStatus = "idle" | "loading" | "ready" | "missing" | "choose" | "error";

export interface WorkspaceContextState {
  status: WorkspaceContextStatus;
  workspaces: WorkspaceOption[];
  /** Live scoped context; `workspaceId` is non-null only when `ready`. */
  context: ScopedViewerContext;
  /** Account the context was resolved for; null when idle. */
  sub: string | null;
  error: string | null;
}

function idleState(): WorkspaceContextState {
  return { status: "idle", workspaces: [], context: emptyScopedViewerContext(), sub: null, error: null };
}

export interface WorkspaceContextStore extends Readable<WorkspaceContextState> {
  /** Resolve the context for one login incarnation (fresh viewer key). */
  load(sub: string, opts?: WorkspaceRequestOptions): Promise<WorkspaceContextState>;
  /** Explicit user pick among the listed workspaces. */
  select(workspaceId: string): void;
  /** Logout / account without scoped access: forget everything. */
  reset(): void;
  /** Current state, read synchronously (launch-time capture). */
  current(): WorkspaceContextState;
}

export function createWorkspaceContextStore(
  fetcher: (opts: WorkspaceRequestOptions) => Promise<WorkspaceOption[]> = fetchWorkspaces,
): WorkspaceContextStore {
  let state = idleState();
  const { subscribe, set } = writable<WorkspaceContextState>(state);
  const publish = (next: WorkspaceContextState) => { state = next; set(next); };
  let generation = 0;

  return {
    subscribe,
    current: () => state,
    reset() {
      generation += 1;
      publish(idleState());
    },
    async load(sub, opts = {}) {
      const operation = ++generation;
      const viewerKey = { context: sub };
      publish({ status: "loading", workspaces: [], context: { viewerKey, workspaceId: null },
        sub, error: null });
      try {
        const workspaces = await fetcher(opts);
        if (operation !== generation) return state;
        const selection = resolveWorkspaceSelection(workspaces);
        publish({
          status: selection.status, workspaces, sub, error: null,
          context: { viewerKey, workspaceId: selection.status === "ready" ? selection.workspaceId : null },
        });
      } catch (error) {
        if (operation !== generation) return state;
        const code = error instanceof WorkspaceClientError ? (error.code ?? error.message) : "workspaces_unavailable";
        publish({ status: "error", workspaces: [], sub, error: code,
          context: { viewerKey, workspaceId: null } });
      }
      return state;
    },
    select(workspaceId) {
      if (state.context.viewerKey === null) return;
      const selection = resolveWorkspaceSelection(state.workspaces, workspaceId);
      if (selection.status !== "ready") return;
      if (state.context.workspaceId === selection.workspaceId) return;
      publish({ ...state, status: "ready",
        context: { viewerKey: state.context.viewerKey, workspaceId: selection.workspaceId } });
    },
  };
}

/** App-owned singleton: App.svelte loads/resets it, signal screens read it. */
export const workspaceContext = createWorkspaceContextStore();

/** French copy for the non-ready states, shown instead of any signal list. */
export function workspaceUnavailableMessage(state: Pick<WorkspaceContextState, "status">): string | null {
  switch (state.status) {
    case "ready":
      return null;
    case "missing":
      return "Aucun espace de travail — les signaux sont indisponibles pour ce compte.";
    case "choose":
      return "Choisissez un espace de travail pour afficher les signaux.";
    case "error":
      return "Espaces de travail illisibles — signaux indisponibles.";
    case "loading":
      return "Chargement de l'espace de travail…";
    default:
      return "Espace de travail indisponible — signaux indisponibles.";
  }
}

/**
 * Resolve once the context is no longer loading (launch-time capture for
 * screens that read once on mount). Never waits on an idle context.
 */
export function settledWorkspaceContext(
  store: Readable<WorkspaceContextState> = workspaceContext,
): Promise<WorkspaceContextState> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    unsubscribe = store.subscribe((state) => {
      if (settled || state.status === "loading") return;
      settled = true;
      resolve(state);
      if (unsubscribe) unsubscribe();
    });
    if (settled) unsubscribe();
  });
}

/** The explicit workspace of a settled context, or the unavailable copy as error. */
export async function requireScopedWorkspace(
  store: Readable<WorkspaceContextState> = workspaceContext,
): Promise<string> {
  const state = await settledWorkspaceContext(store);
  if (state.context.workspaceId === null) {
    throw new WorkspaceClientError(workspaceUnavailableMessage(state) ?? "workspace_missing");
  }
  return state.context.workspaceId;
}
