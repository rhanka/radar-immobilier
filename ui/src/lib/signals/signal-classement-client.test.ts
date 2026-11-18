import { afterEach, describe, expect, it, vi } from "vitest";
import { applyClassement, fetchReasonCodes } from "./signal-classement-client.js";
import type { ClassementEntry } from "./signal-classement.js";

const WS = "11111111-1111-4111-8111-111111111111";
const SCOPE = { workspaceId: WS };
const TARGET = { citySlug: "delson", type: "Signal" as const, id: "sig-1" };
const FINGERPRINT = "a".repeat(64);
const NON_CLASSE: ClassementEntry = {
  classe: "non_classe", reasonCode: null,
  pertinentHeadId: null, aSurveillerHeadId: null,
  pertinentExpectedHeadId: null, aSurveillerExpectedHeadId: null,
  archiveHeadId: null, discarded: false,
  archiveRestores: [], restoreBlockedReason: null,
};

type Call = { url: string; method: string; body: unknown; key: string | null };
function stubFetchOk(fail?: (call: Call, index: number) => { status: number; error: string } | null): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call: Call = {
      url, method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      key: new Headers(init?.headers).get("Idempotency-Key"),
    };
    calls.push(call);
    const failure = fail?.(call, calls.length - 1) ?? null;
    if (failure) {
      return new Response(JSON.stringify({ error: failure.error }), { status: failure.status, headers: { "content-type": "application/json" } });
    }
    const payload = url.includes("reason-codes")
      ? { ok: true, profileId: "immo-steve-2026-09", codes: [{ code: "N-NON-RES", verdict: "non_pertinent" }] }
      : { ok: true, event: { id: `evt-${calls.length}` } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls };
}
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");
const entry = (patch: Partial<ClassementEntry>): ClassementEntry => ({
  ...NON_CLASSE,
  ...(patch.discarded && patch.archiveHeadId ? { archiveRestores: [{
    scope: "personal" as const, id: patch.archiveHeadId, reasonCode: patch.reasonCode ?? null,
  }] } : {}),
  ...patch,
});

afterEach(() => vi.unstubAllGlobals());

describe("signal classement client — acceptance criteria", () => {
  it("should explicitly persist Non classé over a pending MCP classification", async () => {
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, { target: TARGET, displayedFingerprint: FINGERPRINT,
      current: { ...NON_CLASSE, annotationSource: "mcp", classe: "pertinent", mcpVersion: "a".repeat(32) }, nextClass: "non_classe" });
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]?.url).toContain("/annotations/decision");
    expect(posts(calls)[0]?.body).toMatchObject({ classe: "non_classe", version: "a".repeat(32), target: { ...TARGET, scope: "personal" } });
  });
  it("should send an explicit browser confirmation for the same MCP class", async () => {
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, { target: TARGET, displayedFingerprint: FINGERPRINT,
      current: { ...NON_CLASSE, annotationSource: "mcp", classe: "pertinent", mcpVersion: "a".repeat(32) }, nextClass: "pertinent" });
    expect(posts(calls)[0]?.body).toMatchObject({ confirm: true, classe: "pertinent" });
  });
  it("should persist a human Non classé override of an AI class without human heads", async () => {
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, { target: TARGET, displayedFingerprint: FINGERPRINT,
      current: { ...NON_CLASSE, annotationSource: "ai", classe: "pertinent" }, nextClass: "non_classe" });
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]?.url).toContain("/personal/deselect");
    expect(posts(calls)[0]?.body).toMatchObject({ basket: "pertinent", expectedHeadId: null });
  });

  it("should persist explicit human confirmation of the existing AI class", async () => {
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, { target: TARGET, displayedFingerprint: FINGERPRINT,
      current: { ...NON_CLASSE, annotationSource: "ai", classe: "pertinent" }, nextClass: "pertinent" });
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]?.url).toContain("/personal/select");
  });
  it("criterion 5: classification is persisted through the existing basket API endpoints only", async () => {
    const { calls } = stubFetchOk();
    await fetchReasonCodes(SCOPE);
    expect(calls[0]?.url).toBe(`/api/v1/workspaces/${WS}/signal-facets/reason-codes`);

    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT, current: NON_CLASSE,
      nextClass: "ecarte", reasonCode: "N-NON-RES",
    });
    const write = calls.find((c) => c.method === "POST");
    expect(write?.url).toBe(`/api/v1/workspaces/${WS}/signal-facets/personal/discard`);
    expect(write?.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(write?.body).toMatchObject({ target: TARGET, reasonCode: "N-NON-RES", displayedFingerprint: FINGERPRINT });
    for (const call of calls) {
      expect(call.url).toMatch(/^\/api\/v1\/workspaces\/[^/]+\/signal-facets\/(reason-codes|personal\/(select|deselect|discard|restore))$/);
    }
  });

  it("criterion 3: client refuses Écarté without a reason before any request", async () => {
    const { calls } = stubFetchOk();
    await expect(applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT, current: NON_CLASSE, nextClass: "ecarte",
    })).rejects.toThrow("reason_code_required");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("criterion 2/5: selecting Pertinent posts select on the existing personal basket endpoint", async () => {
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT, current: NON_CLASSE, nextClass: "pertinent",
    });
    const write = calls.find((c) => c.method === "POST");
    expect(write?.url).toBe(`/api/v1/workspaces/${WS}/signal-facets/personal/select`);
    expect(write?.body).toMatchObject({ basket: "pertinent", expectedHeadId: null });
  });

  it("covers deselect, restore and Non classé transitions with expected heads", async () => {
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ classe: "pertinent", pertinentHeadId: "p1", reasonCode: "P-DENSITE" }),
      nextClass: "a_surveiller",
    });
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["deselect", "select"]);
    expect(posts(calls)[0]?.body).toMatchObject({ basket: "pertinent", expectedHeadId: "p1" });
    expect(posts(calls)[1]?.body).toMatchObject({ basket: "a_surveiller", expectedHeadId: null });

    calls.length = 0;
    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ classe: "ecarte", discarded: true, archiveHeadId: "arch-1", pertinentHeadId: "p1", reasonCode: "N-NON-RES" }),
      nextClass: "non_classe",
    });
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["reclassify"]);
    expect(posts(calls)[0]?.body).toMatchObject({ archives: { personal: "arch-1" },
      selectionHeads: { pertinent: "p1" }, nextClass: "non_classe" });

    calls.length = 0;
    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ classe: "ecarte", discarded: true, archiveHeadId: "arch-1", reasonCode: "N-NON-RES" }),
      nextClass: "pertinent",
    });
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["reclassify"]);
  });

  it("regression 409: re-classifying a deselected signal sends its inactive head id, not null", async () => {
    // Exact owner case: the signal shows Non classé but its pertinent
    // stream head is an INACTIVE event. The server compares
    // expectedHeadId to that head; null is a facet_head_conflict (409).
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ pertinentExpectedHeadId: "old-pertinent-head" }),
      nextClass: "pertinent",
    });
    expect(posts(calls)[0]?.body).toMatchObject({ basket: "pertinent", expectedHeadId: "old-pertinent-head" });
  });

  it("regression 409: Pertinent then À surveiller sends the inactive a_surveiller head", async () => {
    const { calls } = stubFetchOk();
    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({
        classe: "pertinent", pertinentHeadId: "p1", reasonCode: "P-DENSITE",
        aSurveillerExpectedHeadId: "old-watch-head",
      }),
      nextClass: "a_surveiller",
    });
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["deselect", "select"]);
    expect(posts(calls)[0]?.body).toMatchObject({ basket: "pertinent", expectedHeadId: "p1" });
    expect(posts(calls)[1]?.body).toMatchObject({ basket: "a_surveiller", expectedHeadId: "old-watch-head" });
  });

  it("F4: a failed second POST rolls back the first, keeping the previous classement", async () => {
    const { calls } = stubFetchOk((call) =>
      call.url.endsWith("/select") && (call.body as { basket?: string })?.basket === "a_surveiller"
        ? { status: 409, error: "facet_head_conflict" } : null);
    await expect(applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ classe: "pertinent", pertinentHeadId: "p1", reasonCode: "P-DENSITE" }),
      nextClass: "a_surveiller",
    })).rejects.toMatchObject({ status: 409, code: "facet_head_conflict" });
    // deselect pertinent, failed select, compensating re-select pertinent.
    expect(posts(calls).map((c) => `${c.url.split("/").pop()}:${(c.body as { basket?: string }).basket}`))
      .toEqual(["deselect:pertinent", "select:a_surveiller", "select:pertinent"]);
    expect(posts(calls)[2]?.body).toMatchObject({ reasonCode: "P-DENSITE" });
    // Compensating key differs from the failed command's key.
    expect(new Set(posts(calls).map((c) => c.key)).size).toBe(3);
  });

  it("should send restore and selection as one command without compensation on rejection", async () => {
    const { calls } = stubFetchOk((call) =>
      call.url.endsWith("/reclassify") ? { status: 422, error: "invalid_reason_code" } : null);
    await expect(applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ classe: "ecarte", discarded: true, archiveHeadId: "arch-1", reasonCode: "N-NON-RES" }),
      nextClass: "pertinent", reasonCode: "P-DENSITE",
      catalog: [{ code: "P-DENSITE", verdict: "pertinent" }, { code: "N-NON-RES", verdict: "non_pertinent" }],
    })).rejects.toMatchObject({ status: 422, code: "invalid_reason_code" });
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["reclassify"]);
    expect(posts(calls)[0]?.body).toMatchObject({ nextClass: "pertinent", reasonCode: "P-DENSITE" });
  });

  it("should restore both scopes atomically without compensation on conflict", async () => {
    const { calls } = stubFetchOk((call) =>
      call.url.endsWith("/reclassify") ? { status: 409, error: "facet_head_conflict" } : null);
    await expect(applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT, nextClass: "pertinent",
      current: entry({ classe: "ecarte", discarded: true, archiveRestores: [
        { scope: "personal", id: "private", reasonCode: "N-NON-RES" },
        { scope: "workspace", id: "shared", reasonCode: "N-AUTRE" },
      ] }),
    })).rejects.toMatchObject({ status: 409 });
    expect(posts(calls).map((call) => call.url.split("/signal-facets/")[1])).toEqual([
      "personal/reclassify",
    ]);
    expect(posts(calls)[0]?.body).toMatchObject({ archives: { personal: "private", workspace: "shared" }, nextClass: "pertinent" });
  });

  it("should recover an uncertain 502 with the identical command key and payload", async () => {
    const { calls } = stubFetchOk((_call, index) => index === 0 ? { status: 502, error: "lost_response" } : null);
    await applyClassement(SCOPE, { target: TARGET, displayedFingerprint: FINGERPRINT, nextClass: "non_classe",
      current: entry({ classe: "ecarte", discarded: true, archiveHeadId: "arch-1" }) });
    expect(posts(calls)).toHaveLength(2);
    expect(posts(calls)[1]).toEqual(posts(calls)[0]);
  });

  it("should refuse shared restoration before any write when moderation is missing", async () => {
    const { calls } = stubFetchOk();
    await expect(applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT, nextClass: "non_classe",
      current: entry({ classe: "ecarte", discarded: true, restoreBlockedReason: "Moderator required" }),
    })).rejects.toThrow("workspace_capability_required");
    expect(calls).toHaveLength(0);
  });

  it("surfaces 409, 422 and fingerprint-conflict errors with status and code", async () => {
    for (const [status, code] of [[409, "facet_head_conflict"], [422, "invalid_reason_code"], [409, "target_version_conflict"]] as const) {
      vi.unstubAllGlobals();
      stubFetchOk(() => ({ status, error: code }));
      await expect(applyClassement(SCOPE, {
        target: TARGET, displayedFingerprint: FINGERPRINT, current: NON_CLASSE, nextClass: "pertinent",
      })).rejects.toMatchObject({ status, code });
    }
  });

  it("F10: fails closed without crypto.randomUUID instead of a constant key", async () => {
    stubFetchOk();
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", {});
    try {
      await expect(applyClassement(SCOPE, {
        target: TARGET, displayedFingerprint: FINGERPRINT, current: NON_CLASSE, nextClass: "pertinent",
      })).rejects.toThrow("random_uuid_unavailable");
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });
});
