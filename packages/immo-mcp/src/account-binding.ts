import pg from "pg";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ARTIFACT_TOOL_NAMES } from "./registry/artifact-profile.js";
import { bindDatabaseName } from "./database-url.js";
import { reconcileAdmissionLink, type AdmissionJitInput } from "./admission-jit.js";

/**
 * General opening (artefacts-ouverture L2): the four artifact tools publish
 * for every approved account. Stale workspace claims never block publication;
 * the host admission (account status reread at entry, commit and replay, plus
 * the shared storage rules) stays the governing gate. Business tools keep
 * their membership controls unchanged.
 */
const ARTIFACT_TOOLS = new Set<string>(ARTIFACT_TOOL_NAMES);

export interface AccountQuery {
  query(sql: string, args: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export class AccountBindingUnavailable extends Error {
  readonly retriable = true;
  constructor() { super("account_binding_unavailable"); this.name = "AccountBindingUnavailable"; }
}

function logAccountDisconnect(): void {
  process.stderr.write('{"kind":"immo-mcp.account","error":"account_binding_unavailable","retriable":true}\n');
}

export interface AccountJit {
  /** Issuers trusted for JIT email linking (admission staging + user IdP). */
  trustedIssuers: string[];
  /**
   * Link the MCP subject by verified email. Runs on a WRITABLE handle (the
   * read binding stays read-only); resolves the outcome, never throws into
   * the gate — a failed link keeps the historical closed behaviour.
   */
  reconcile: (input: AdmissionJitInput) => Promise<unknown>;
}

export interface AccountAuthorizerOptions {
  jit?: AccountJit;
}

/**
 * Read the JIT identity carried on the request principal. Populated by the
 * HTTP dispatch from the already-verified upstream token claims (never from
 * tool arguments); absent on paths without a bearer (stdio stub).
 */
function jitInputFromRequest(request: VerifiedMcpRequest): AdmissionJitInput | undefined {
  const attributes = request.principal.attributes as unknown as Record<string, unknown> | null | undefined;
  const email = attributes?.["email"];
  const issuer = attributes?.["idpIssuer"];
  if (typeof email !== "string" || email.trim() === "" || typeof issuer !== "string" || issuer === "") {
    return undefined;
  }
  return {
    sub: request.principal.sub,
    email,
    emailVerified: attributes?.["emailVerified"] === true,
    issuer,
  };
}

/** Trusted read-only binding, queried for each call; caller arguments never supply identity. */
export function accountAuthorizer(
  db: AccountQuery,
  env: NodeJS.ProcessEnv = process.env,
  opts: AccountAuthorizerOptions = {},
) {
  const read: AccountQuery["query"] = async (sql, args) => {
    try { return await db.query(sql, args); }
    catch { throw new AccountBindingUnavailable(); }
  };
  const readAccount = async (sub: string): Promise<Record<string, unknown> | undefined> => {
    const rows = await read("SELECT id, status FROM account_users WHERE sub = $1 LIMIT 1", [sub]);
    return rows.rows[0];
  };
  return async (_tool: string, request: VerifiedMcpRequest): Promise<boolean> => {
    let account = await readAccount(request.principal.sub);
    // Lot I1 (R1/b): a prod-approved user opening MCP first has no preprod
    // row yet. Reconcile by verified email before refusing, then re-read.
    if (account?.status !== "approved" && opts.jit && opts.jit.trustedIssuers.length > 0) {
      const input = jitInputFromRequest(request);
      if (input && opts.jit.trustedIssuers.includes(input.issuer)) {
        try {
          await opts.jit.reconcile(input);
        } catch {
          return false;
        }
        try {
          account = await readAccount(request.principal.sub);
        } catch {
          throw new AccountBindingUnavailable();
        }
      }
    }
    if (account?.status !== "approved") return false;
    if (ARTIFACT_TOOLS.has(_tool) && env.ARTIFACTS_CONTROL_MODE?.trim() === "general") return true;
    const workspaces = request.principal.attributes.workspaces;
    if (!Array.isArray(workspaces) || workspaces.some((w) => typeof w !== "string")) return false;
    // The historical default is a transport placeholder, never a membership assertion.
    const ids = [...new Set(workspaces.filter((w: string) => w !== "default"))];
    if (ids.length === 0) return true;
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return false;
    const memberships = await read(
      "SELECT workspace_id FROM workspace_memberships WHERE account_id = $1 AND workspace_id = ANY($2::uuid[]) AND status = 'active' AND revoked_at IS NULL",
      [account.id, ids],
    );
    return new Set(memberships.rows.map((row) => String(row.workspace_id).toLowerCase())).size === ids.length;
  };
}

export function createAccountBinding(env: NodeJS.ProcessEnv) {
  const url = env.IMMO_MCP_ACCOUNT_DATABASE_URL;
  if (!url) return undefined;
  const pool = new pg.Pool({ connectionString: bindDatabaseName(url, env.IMMO_MCP_DATABASE_NAME), max: 2, connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10_000, options: "-c default_transaction_read_only=on -c statement_timeout=2000" });
  // pg evicts the broken idle client before emitting; the next query opens a fresh connection.
  pool.on("error", logAccountDisconnect);
  // Lot I1 (R1/b): JIT linking needs writes, which the read-only pool above
  // cannot perform. A second, writable pool serves ONLY the reconcile path,
  // and only when trusted issuers are configured; otherwise the gate keeps
  // its historical closed behaviour for unknown subjects.
  const trustedIssuers = (env.ADMISSION_TRUSTED_ISSUERS ?? "")
    .split(",").map((part) => part.trim()).filter((part) => part !== "");
  let jit: AccountJit | undefined;
  let closeJit = () => Promise.resolve();
  if (trustedIssuers.length > 0) {
    const writePool = new pg.Pool({ connectionString: bindDatabaseName(url, env.IMMO_MCP_DATABASE_NAME), max: 2,
      connectionTimeoutMillis: 2000, idleTimeoutMillis: 10_000, options: "-c statement_timeout=2000" });
    writePool.on("error", logAccountDisconnect);
    jit = {
      trustedIssuers,
      reconcile: (input) => reconcileAdmissionLink(writePool, input, { trustedIssuers }),
    };
    closeJit = () => writePool.end().then(() => undefined);
  }
  return {
    authorize: accountAuthorizer(pool, env, ...(jit ? [{ jit } satisfies AccountAuthorizerOptions] : [])),
    close: () => Promise.all([pool.end(), closeJit()]).then(() => undefined),
  };
}
