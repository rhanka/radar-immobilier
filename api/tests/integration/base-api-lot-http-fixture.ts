import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { createApp } from "../../src/app.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import {
  lotFixture,
  type LotFixture,
} from "../../src/services/facets/lots/lot-fixture.js";
import { resolveLotSource } from "../../src/services/facets/lots/lot-target.js";

const subjects = vi.hoisted(() => new Map<string, string>());
vi.mock("../../src/services/auth/oidc.js", async (original) => ({
  ...await original<typeof import("../../src/services/auth/oidc.js")>(),
  verifyAccessToken: vi.fn(async (token: string) => {
    const sub = subjects.get(token);
    if (!sub) throw new Error("Invalid synthetic bearer");
    return { sub };
  }),
}));

export function verifiedLotBearer(sub: string): Record<string, string> {
  const token = `synthetic-lot:${sub}:${randomUUID()}`;
  subjects.set(token, sub);
  return { authorization: `Bearer ${token}` };
}

export interface LotComposed {
  fixture: LotFixture;
  app: ReturnType<typeof createApp>;
  lotBase: string;
  request: (path: string, sub: string, init?: RequestInit) => Promise<Response>;
  command: (
    scope: "workspace" | "personal",
    body: Record<string, unknown>,
    sub: string,
    key?: string,
  ) => Promise<Response>;
  batch: (
    scope: "workspace" | "personal",
    body: Record<string, unknown>,
    sub: string,
    key?: string,
  ) => Promise<Response>;
  resolve: (index: number) => Promise<{
    target: { type: "Lot"; authority: "lot_versions"; citySlug: string; canonicalId: string };
    displayed: { lot_version_id: string; fingerprint: string };
  }>;
  sqlSnapshot: () => Promise<unknown[]>;
}

const LOT_SNAPSHOT_TABLES = [
  "facet_events",
  "facet_event_bindings",
  "facet_streams",
  "facet_heads",
  "facet_commands",
  "facet_command_contexts",
  "personal_projection_revisions",
  "workspace_projection_revisions",
];

export async function lotHttpFixture(): Promise<LotComposed> {
  return composeLotApp(await lotFixture());
}

export function composeLotApp(fixture: LotFixture): LotComposed {
  const app = createApp({
    checkDb: async () => ({ ok: true }),
    checkObjectStore: async () => ({ ok: true }),
    store: {} as ObjectStore,
    db: fixture.db,
    discarded: EMPTY_DISCARDED_SIGNALS,
    auth: baseAuth,
  });
  const lotBase = `/api/v1/workspaces/${fixture.workspaceId}/lot-facets`;
  const request = async (path: string, sub: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) headers.set("cookie", await baseCookie(sub));
    return app.request(path, { ...init, headers });
  };
  const command = (
    scope: "workspace" | "personal",
    body: Record<string, unknown>,
    sub: string,
    key: string = randomUUID(),
  ) =>
    request(`${lotBase}/${scope}/commands`, sub, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
  const batch = (
    scope: "workspace" | "personal",
    body: Record<string, unknown>,
    sub: string,
    key: string = randomUUID(),
  ) =>
    request(`${lotBase}/${scope}/commands/batch`, sub, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
  const resolve = async (index: number) => {
    const target = {
      type: "Lot" as const,
      authority: "lot_versions" as const,
      citySlug: "synthetic-6j-city",
      canonicalId: ["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"][index % 2]!,
    };
    const resolved = await resolveLotSource(fixture.db, target);
    return { target, displayed: resolved.displayed };
  };
  const sqlSnapshot = async () =>
    Promise.all(LOT_SNAPSHOT_TABLES.map(async (table) =>
      (await fixture.pool.query(
        `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
      )).rows));
  return { fixture, app, lotBase, request, command, batch, resolve, sqlSnapshot };
}
