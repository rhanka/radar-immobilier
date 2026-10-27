import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createHostPolicy } from "./commit-policy.js";
import { POLICY_REVISION } from "./transaction-authority.js";
import { general, SCOPE } from "./general-harness.js";

describe("general commit policy without memberships", () => {
  function mockPool(rows: { revision?: string; status?: string }) {
    const texts: string[] = [];
    const handle = async (text: string) => {
      texts.push(text);
      if (text.includes("INSERT INTO artifacts.host_policy")) return { rowCount: 1, rows: [] };
      if (text.includes("FROM artifacts.host_policy")) {
        return { rowCount: 1, rows: [{ revision: rows.revision ?? POLICY_REVISION }] };
      }
      if (text.includes("FROM account_users")) {
        return { rowCount: 1, rows: [{ id: "acc-1", status: rows.status ?? "approved" }] };
      }
      throw new Error(`unexpected query: ${text}`);
    };
    const pool = { query: vi.fn(handle) };
    const client = { query: vi.fn(handle) };
    return { pool: pool as unknown as pg.Pool, client: client as never, texts };
  }

  it("approves an approved account without reading memberships", async () => {
    const { pool, client, texts } = mockPool({});
    const policy = await createHostPolicy(pool, SCOPE, () => general());
    const participant = policy.createParticipant(client, "token");
    await expect(participant.checkApproval?.({ actorId: "alice", operation: "ensure" } as never))
      .resolves.toEqual({ approved: true, workspaceId: "" });
    expect(texts.some((text) => text.includes("workspace_memberships"))).toBe(false);
  });

  it("refuses a suspended account as not approved", async () => {
    const { pool, client } = mockPool({ status: "suspended" });
    const policy = await createHostPolicy(pool, SCOPE, () => general());
    const participant = policy.createParticipant(client, "token");
    await expect(participant.checkApproval?.({ actorId: "alice", operation: "ensure" } as never))
      .resolves.toMatchObject({ approved: false, publicCode: "account_not_approved", status: 403 });
  });
});

describe("per-actor durable quotas independent of attempt admission", () => {
  function mockClient(script: { actorRowCount?: number; globalRowCount?: number }) {
    const texts: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        texts.push(text);
        if (text.includes("FROM artifacts.host_policy")) return { rowCount: 1, rows: [{ revision: POLICY_REVISION }] };
        if (text.includes("FROM account_users")) return { rowCount: 1, rows: [{ id: "acc-1", status: "approved" }] };
        if (text.includes("UPDATE artifacts.host_quotas")) return { rowCount: script.globalRowCount ?? 1, rows: [] };
        if (text.includes("INSERT INTO artifacts.host_actor_quotas")) return { rowCount: 1, rows: [] };
        if (text.includes("UPDATE artifacts.host_actor_quotas")) return { rowCount: script.actorRowCount ?? 1, rows: [] };
        throw new Error(`unexpected query: ${text}`);
      }),
    };
    return { client: client as never, texts };
  }

  async function participantWith(script: Parameters<typeof mockClient>[0]) {
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [] })) } as unknown as pg.Pool;
    const policy = await createHostPolicy(pool, SCOPE, () => general());
    const { client, texts } = mockClient(script);
    return { participant: policy.createParticipant(client, "token"), texts };
  }

  it("reserves global and actor ceilings without touching attempt counters", async () => {
    const { participant, texts } = await participantWith({});
    await participant.checkApproval?.({ actorId: "alice" } as never);
    await expect(participant.reserveQuota?.({ actorId: "alice", storageScopeId: SCOPE, bytes: 100 } as never))
      .resolves.toEqual({ reserved: true });
    expect(texts.findIndex((text) => text.includes("UPDATE artifacts.host_quotas")))
      .toBeLessThan(texts.findIndex((text) => text.includes("host_actor_quotas")));
    expect(texts.some((text) => text.includes("host_actor_rate"))).toBe(false);
  });

  it("blocks a commit when the global row is missing or exhausted", async () => {
    const { participant, texts } = await participantWith({ globalRowCount: 0 });
    await participant.checkApproval?.({ actorId: "alice" } as never);
    await expect(participant.reserveQuota?.({ actorId: "alice", storageScopeId: SCOPE, bytes: 100 } as never))
      .resolves.toEqual({ reserved: false });
    expect(texts.some((text) => text.includes("host_actor_quotas"))).toBe(false);
  });

  it("blocks a commit when the actor row is missing or exhausted", async () => {
    const { participant, texts } = await participantWith({ actorRowCount: 0 });
    await participant.checkApproval?.({ actorId: "alice" } as never);
    await expect(participant.reserveQuota?.({ actorId: "alice", storageScopeId: SCOPE, bytes: 100 } as never))
      .resolves.toEqual({ reserved: false });
    expect(texts.some((text) => text.includes("host_actor_rate"))).toBe(false);
  });

  it("reserves actor quotas before approval, matching the coordinator order", async () => {
    const { participant, texts } = await participantWith({});
    await expect(participant.reserveQuota?.({ actorId: "alice", storageScopeId: SCOPE, bytes: 100 } as never))
      .resolves.toEqual({ reserved: true });
    expect(texts.some((text) => text.includes("host_actor_quotas"))).toBe(true);
    expect(texts.some((text) => text.includes("host_actor_rate"))).toBe(false);
  });
});
