/**
 * Ops recipients port v1 (frozen Sentropic port contract, immo side L4).
 *
 * `GET /api/v1/ops/recipients?target=immo-prod|immo-preprod` answers the
 * platform alert service: who are this product's admins. Recipients are
 * resolved live on every call and never hardcoded:
 *   - active members holding `manage_members` on the reference workspace
 *     (`workspace_memberships.revoked_at IS NULL`, `status = 'active'`),
 *   - plus `account_users.is_admin = true` with `status = 'approved'`,
 * deduplicated by account. The reference workspace slug comes from
 * `OPS_REFERENCE_WORKSPACE_SLUG` (configuration), never a literal here.
 *
 * Pre-A4 fallback: when the workspace tables do not exist yet (prod
 * before A4), the workspace query fails with SQLSTATE 42P01 and the
 * endpoint falls back to `is_admin` alone; the `basis` of every returned
 * admin then carries only `app:is_admin`, which states the fallback.
 *
 * Authentication is service-to-service: a service-client bearer verified
 * with the same mechanism as the per-user bearer path — `verifyAccessToken`
 * (IdP JWKS signature, `iss`, `exp`, `aud`) in `services/auth/oidc.ts`,
 * the inbound counterpart of the OAuth `client_credentials` fetcher in
 * `packages/artifacts-host/src/git-mode/service-token.ts`. The exact
 * audience is fixed by the Sentropic L1 contract and injected via
 * `OPS_RECIPIENTS_AUDIENCE`; without it the route stays closed (503).
 */
import { Hono } from "hono";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import type { OpsTarget } from "../config.js";
import type { Database } from "../db/client.js";
import {
  accountUsers,
  workspaceMemberships,
  workspaces,
} from "../db/schema.js";
import { verifyAccessToken } from "../services/auth/oidc.js";

export const OPS_RECIPIENTS_PATH = "/api/v1/ops/recipients";

export type RecipientBasis = "workspace:manage_members" | "app:is_admin";

export interface OpsRecipient {
  readonly accountRef: string;
  readonly email: string;
  readonly basis: readonly RecipientBasis[];
}

export interface OpsRecipientsResponse {
  readonly v: 1;
  readonly target: OpsTarget;
  readonly asOf: string;
  readonly admins: readonly OpsRecipient[];
}

interface AccountRow {
  readonly accountRef: string;
  readonly email: string | null;
}

/** Read port over the account/workspace tables (mocked in unit tests). */
export interface RecipientsStore {
  listAppAdmins(): Promise<readonly AccountRow[]>;
  listWorkspaceManagers(
    workspaceSlug: string,
  ): Promise<readonly AccountRow[]>;
}

const BASIS_ORDER: readonly RecipientBasis[] = [
  "workspace:manage_members",
  "app:is_admin",
];

/**
 * Merge app admins and workspace managers by account. Rows without an
 * email cannot be alerted and are dropped. Output is sorted by account
 * so identical database state yields identical payloads.
 */
export function mergeRecipients(
  appAdmins: readonly AccountRow[],
  workspaceManagers: readonly AccountRow[],
): OpsRecipient[] {
  const byAccount = new Map<string, { email: string; basis: Set<RecipientBasis> }>();
  const add = (rows: readonly AccountRow[], basis: RecipientBasis) => {
    for (const row of rows) {
      const email = row.email?.trim();
      if (!email) continue;
      const current = byAccount.get(row.accountRef);
      if (current) current.basis.add(basis);
      else byAccount.set(row.accountRef, { email, basis: new Set([basis]) });
    }
  };
  add(workspaceManagers, "workspace:manage_members");
  add(appAdmins, "app:is_admin");
  return [...byAccount.entries()]
    .map(([accountRef, value]) => ({
      accountRef,
      email: value.email,
      basis: BASIS_ORDER.filter((basis) => value.basis.has(basis)),
    }))
    .sort((a, b) => a.accountRef.localeCompare(b.accountRef));
}

/** True when Postgres reports a missing workspace table (SQLSTATE 42P01). */
export function isMissingWorkspaceTablesError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === "42P01") return true;
    const message =
      error instanceof Error ? error.message : String(
        (error as { message?: unknown }).message ?? "",
      );
    return (
      message.includes("does not exist") &&
      (message.includes("workspace_memberships") ||
        message.includes("workspaces"))
    );
  }
  return false;
}

export function createDrizzleRecipientsStore(
  db: Pick<Database, "select">,
): RecipientsStore {
  return {
    async listAppAdmins() {
      return db
        .select({ accountRef: accountUsers.id, email: accountUsers.email })
        .from(accountUsers)
        .where(
          and(
            eq(accountUsers.isAdmin, true),
            eq(accountUsers.status, "approved"),
          ),
        );
    },
    async listWorkspaceManagers(workspaceSlug: string) {
      return db
        .select({ accountRef: accountUsers.id, email: accountUsers.email })
        .from(workspaceMemberships)
        .innerJoin(
          workspaces,
          eq(workspaces.id, workspaceMemberships.workspaceId),
        )
        .innerJoin(
          accountUsers,
          eq(accountUsers.id, workspaceMemberships.accountId),
        )
        .where(
          and(
            eq(workspaces.slug, workspaceSlug),
            eq(workspaceMemberships.status, "active"),
            isNull(workspaceMemberships.revokedAt),
            eq(workspaceMemberships.manageMembers, true),
            eq(accountUsers.status, "approved"),
          ),
        );
    },
  };
}

export interface ResolvedRecipients {
  readonly admins: readonly OpsRecipient[];
  /** False on the pre-A4 fallback (workspace tables absent/unconfigured). */
  readonly workspaceTierAvailable: boolean;
}

export async function resolveRecipients(
  store: RecipientsStore,
  referenceWorkspaceSlug: string | undefined,
): Promise<ResolvedRecipients> {
  const appAdmins = await store.listAppAdmins();
  if (!referenceWorkspaceSlug) {
    return { admins: mergeRecipients(appAdmins, []), workspaceTierAvailable: false };
  }
  try {
    const managers = await store.listWorkspaceManagers(referenceWorkspaceSlug);
    return {
      admins: mergeRecipients(appAdmins, managers),
      workspaceTierAvailable: true,
    };
  } catch (error) {
    if (!isMissingWorkspaceTablesError(error)) throw error;
    return { admins: mergeRecipients(appAdmins, []), workspaceTierAvailable: false };
  }
}

export interface OpsRouteDeps {
  readonly db?: Database;
  /** Test seam replacing the Drizzle store. */
  readonly store?: RecipientsStore;
  readonly issuer: string;
  readonly jwksUri: string;
  /** Exact `aud` required on the service-client bearer (L1 contract). */
  readonly audience?: string;
  /** This instance's target; any other `target` answers 404. */
  readonly expectedTarget?: OpsTarget;
  /** Reference workspace slug from `OPS_REFERENCE_WORKSPACE_SLUG`. */
  readonly referenceWorkspaceSlug?: string;
  /** Test seam for JWKS verification (local key set). */
  readonly getKey?: JWTVerifyGetKey;
  readonly now?: () => number;
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : undefined;
}

/**
 * The recipients route. Mounted before the session `protect` middleware
 * (same placement as the artifacts live-host routes): it authenticates
 * the service client itself and never reads a browser session.
 * `deps === null` mounts the closed capability (503).
 */
export function opsRecipientsRoute(deps: OpsRouteDeps | null): Hono {
  const app = new Hono();
  app.use(OPS_RECIPIENTS_PATH, async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });
  app.get(OPS_RECIPIENTS_PATH, async (c) => {
    if (!deps || !deps.audience || !deps.expectedTarget || !deps.issuer) {
      return c.json({ error: "ops_recipients_unconfigured" }, 503);
    }
    const store = deps.store ?? (deps.db ? createDrizzleRecipientsStore(deps.db) : undefined);
    if (!store) return c.json({ error: "ops_recipients_unconfigured" }, 503);
    const bearer = extractBearerToken(c.req.header("authorization"));
    if (!bearer) return c.json({ error: "unauthenticated" }, 401);
    let getKey = deps.getKey;
    if (!getKey) {
      if (!deps.jwksUri) {
        return c.json({ error: "ops_recipients_unconfigured" }, 503);
      }
      getKey = createRemoteJWKSet(new URL(deps.jwksUri));
    }
    const now = deps.now ?? (() => Date.now());
    try {
      await verifyAccessToken(bearer, {
        issuer: deps.issuer,
        audiences: [deps.audience],
        getKey,
        now: now(),
      });
    } catch {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const target = c.req.query("target");
    if (target !== deps.expectedTarget) {
      return c.json({ error: "target_not_found" }, 404);
    }
    let resolved: ResolvedRecipients;
    try {
      resolved = await resolveRecipients(store, deps.referenceWorkspaceSlug);
    } catch {
      return c.json({ error: "recipients_unavailable" }, 503);
    }
    const body: OpsRecipientsResponse = {
      v: 1,
      target: deps.expectedTarget,
      asOf: new Date(now()).toISOString(),
      admins: resolved.admins,
    };
    return c.json(body);
  });
  return app;
}
