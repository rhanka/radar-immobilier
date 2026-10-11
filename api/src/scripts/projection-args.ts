/**
 * GH #817 — argv of `project-graph-from-s3`.
 *
 *   project-graph-from-s3 [slug …]                                  # unchanged: every city, or these
 *   project-graph-from-s3 --remove=<id>,… --lose=<id>:<key>,… [--preview] <slug>
 *
 * The declared changes (spec SPEC_FIX_GRAPH_CITY_KEY §17) belong to exactly ONE city:
 * `--remove` lists the node ids the projection must delete, `--lose` the business
 * properties (`props.properties.<key>`) it may drop from nodes it keeps. Both are
 * bounded and validated here; the projection then checks them against its plan.
 * `--preview` (declared mode only) runs the projection and rolls it back.
 */
import type { DeclaredChanges } from "../services/graph/graph-store.js";

export const MAX_DECLARED_REMOVALS = 64;
export const MAX_DECLARED_LOSSES = 16;

const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROPERTY_KEY_RE = /^[A-Za-z0-9_]{1,64}$/;
const CITY_SLUG_RE = /^[a-z0-9]+(?:-{1,2}[a-z0-9]+)*$/;

export interface ProjectionArgs {
  slugs: string[];
  declared?: DeclaredChanges;
  preview: boolean;
}

export class ProjectionArgsError extends Error {
  constructor(message: string) {
    super(`project-graph-from-s3: ${message}`);
    this.name = "ProjectionArgsError";
  }
}

function list(flag: string, value: string): string[] {
  if (value.length === 0) throw new ProjectionArgsError(`${flag} is empty`);
  return value.split(",");
}

function parseRemovals(value: string): Set<string> {
  const ids = list("--remove", value);
  if (ids.length > MAX_DECLARED_REMOVALS) {
    throw new ProjectionArgsError(`--remove lists ${ids.length} ids, at most ${MAX_DECLARED_REMOVALS}`);
  }
  const out = new Set<string>();
  for (const id of ids) {
    if (!NODE_ID_RE.test(id)) throw new ProjectionArgsError(`--remove: invalid node id ${JSON.stringify(id)}`);
    if (out.has(id)) throw new ProjectionArgsError(`--remove: duplicate id ${id}`);
    out.add(id);
  }
  return out;
}

function parseLosses(value: string): Map<string, Set<string>> {
  const entries = list("--lose", value);
  if (entries.length > MAX_DECLARED_LOSSES) {
    throw new ProjectionArgsError(`--lose lists ${entries.length} losses, at most ${MAX_DECLARED_LOSSES}`);
  }
  const out = new Map<string, Set<string>>();
  for (const entry of entries) {
    const parts = entry.split(":");
    const [id, key] = parts;
    if (parts.length !== 2 || !id || !key || !NODE_ID_RE.test(id) || !PROPERTY_KEY_RE.test(key)) {
      throw new ProjectionArgsError(`--lose: invalid property loss ${JSON.stringify(entry)} (expected <id>:<key>)`);
    }
    const keys = out.get(id) ?? new Set<string>();
    if (keys.has(key)) throw new ProjectionArgsError(`--lose: duplicate loss ${entry}`);
    keys.add(key);
    out.set(id, keys);
  }
  return out;
}

/** Parse the script argv (without `node` and the script path). Throws `ProjectionArgsError`. */
export function parseProjectionArgs(argv: readonly string[]): ProjectionArgs {
  const slugs: string[] = [];
  let removals: Set<string> | undefined;
  let losses: Map<string, Set<string>> | undefined;
  let preview = false;
  const seen = new Set<string>();

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      slugs.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (seen.has(flag)) throw new ProjectionArgsError(`${flag} given more than once`);
    seen.add(flag);
    if (flag === "--remove" && eq !== -1) removals = parseRemovals(arg.slice(eq + 1));
    else if (flag === "--lose" && eq !== -1) losses = parseLosses(arg.slice(eq + 1));
    else if (arg === "--preview") preview = true;
    else throw new ProjectionArgsError(`unknown option ${JSON.stringify(arg)}`);
  }

  if (removals === undefined && losses === undefined) {
    if (preview) throw new ProjectionArgsError("--preview needs a declaration (--remove / --lose)");
    return { slugs, preview: false };
  }
  if (slugs.length !== 1) {
    throw new ProjectionArgsError(`declared changes need exactly one city slug, got ${slugs.length}`);
  }
  if (!CITY_SLUG_RE.test(slugs[0]!)) throw new ProjectionArgsError(`invalid city slug ${JSON.stringify(slugs[0])}`);
  const declared: DeclaredChanges = {
    removals: removals ?? new Set(),
    propertyLosses: losses ?? new Map(),
  };
  for (const id of declared.propertyLosses.keys()) {
    if (declared.removals.has(id)) throw new ProjectionArgsError(`node ${id} is both removed and losing a property`);
  }
  return { slugs, declared, preview };
}
