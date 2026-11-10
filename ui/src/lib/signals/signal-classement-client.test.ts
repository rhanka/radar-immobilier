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
const entry = (patch: Partial<ClassementEntry>): ClassementEntry => ({ ...NON_CLASSE, ...patch });

afterEach(() => vi.unstubAllGlobals());

describe("signal classement client — acceptance criteria", () => {
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
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["restore", "deselect"]);
    expect(posts(calls)[0]?.body).toMatchObject({ expectedHeadId: "arch-1" });
    expect(posts(calls)[1]?.body).toMatchObject({ basket: "pertinent", expectedHeadId: "p1" });

    calls.length = 0;
    await applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ classe: "ecarte", discarded: true, archiveHeadId: "arch-1", reasonCode: "N-NON-RES" }),
      nextClass: "pertinent",
    });
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["restore", "select"]);
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

  it("F4: a failed select after restore re-discards with the previous reason", async () => {
    const { calls } = stubFetchOk((call) =>
      call.url.endsWith("/select") ? { status: 422, error: "invalid_reason_code" } : null);
    await expect(applyClassement(SCOPE, {
      target: TARGET, displayedFingerprint: FINGERPRINT,
      current: entry({ classe: "ecarte", discarded: true, archiveHeadId: "arch-1", reasonCode: "N-NON-RES" }),
      nextClass: "pertinent", reasonCode: "P-DENSITE",
      catalog: [{ code: "P-DENSITE", verdict: "pertinent" }, { code: "N-NON-RES", verdict: "non_pertinent" }],
    })).rejects.toMatchObject({ status: 422, code: "invalid_reason_code" });
    expect(posts(calls).map((c) => c.url.split("/").pop())).toEqual(["restore", "select", "discard"]);
    expect(posts(calls)[2]?.body).toMatchObject({ reasonCode: "N-NON-RES" });
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
