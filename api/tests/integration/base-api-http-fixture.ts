import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { createApp } from "../../src/app.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import type { LegacyRetirementState } from "../../src/services/facets/legacy-retirement.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";

const subjects = vi.hoisted(() => new Map<string, string>());
vi.mock("../../src/services/auth/oidc.js", async (original) => ({
  ...await original<typeof import("../../src/services/auth/oidc.js")>(),
  verifyAccessToken: vi.fn(async (token: string) => {
    const sub = subjects.get(token);
    if (!sub) throw new Error("Invalid synthetic bearer");
    return { sub };
  }),
}));

export function verifiedBearer(sub: string): HeadersInit {
  const token = `synthetic:${sub}`;
  subjects.set(token, sub);
  return { authorization: `Bearer ${token}` };
}

export async function httpFixture(retirement?: LegacyRetirementState) {
  const data = await workspaceFixture();
  const signal = await workspaceSignal(data);
  const app = createApp({
    checkDb: async () => ({ ok: true }),
    checkObjectStore: async () => ({ ok: true }),
    store: {} as ObjectStore, db: data.db,
    discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth,
    ...(retirement ? { retirement } : {}),
  });
  const path = (suffix: string) =>
    `/api/v1/workspaces/${data.workspaceId}/signal-facets/${suffix}`;
  const request = async (url: string, sub = data.contributor.sub, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) headers.set("cookie", await baseCookie(sub));
    return app.request(url, { ...init, headers });
  };
  const command = (family: "personal" | "workspace", action: string,
    body: Record<string, unknown>, sub = data.contributor.sub, key = randomUUID()) =>
    request(path(`${family}/${action}`), sub, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
  return { data, signal, app, path, request, command };
}
