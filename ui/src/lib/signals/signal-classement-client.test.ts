import { afterEach, describe, expect, it, vi } from "vitest";
import { applyClassement, fetchReasonCodes } from "./signal-classement-client.js";
import type { ClassementEntry } from "./signal-classement.js";

const WS = "11111111-1111-4111-8111-111111111111";
const SCOPE = { workspaceId: WS };
const TARGET = { citySlug: "delson", type: "Signal" as const, id: "sig-1" };
const FINGERPRINT = "a".repeat(64);
const NON_CLASSE: ClassementEntry = {
  classe: "non_classe", reasonCode: null,
  pertinentHeadId: null, aSurveillerHeadId: null, archiveHeadId: null, discarded: false,
};

function stubFetchOk(): { calls: { url: string; method: string; body: unknown; key: string | null }[] } {
  const calls: { url: string; method: string; body: unknown; key: string | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url, method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      key: new Headers(init?.headers).get("Idempotency-Key"),
    });
    const payload = url.includes("reason-codes")
      ? { ok: true, profileId: "immo-steve-2026-09", codes: [{ code: "N-NON-RES", verdict: "non_pertinent" }] }
      : { ok: true, event: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls };
}

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
});
