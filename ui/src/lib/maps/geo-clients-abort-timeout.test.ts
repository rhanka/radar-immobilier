/**
 * Tests câblage anti-course + timeout des clients géo (bout-en-bout).
 *
 * Prouve que le `signal` et le `timeoutMs` traversent bien `fetchLots`,
 * `fetchGeoZones`, `fetchZones` et `fetchSignalDetail` jusqu'à `fetchWithTimeout` :
 *  - un signal externe déjà/qui avorte → AbortError (réponse à IGNORER) ;
 *  - un timeout dépassé → RequestTimeoutError (état d'erreur honnête de la couche).
 *
 * C'est le socle testable du correctif « une réponse en retard ne peint jamais
 * la mauvaise ville » côté réseau : les vues combinent ces clients avec la garde
 * RequestGuard (cf. request-guard.test.ts) pour ignorer/annuler le périmé.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLots } from "./lots-client.js";
import { fetchGeoZones } from "./geo-zones-client.js";
import { fetchZones } from "./zones-client.js";
import { fetchSignalDetail } from "$lib/signals/signal-detail-client.js";
import { isAbortError, RequestTimeoutError } from "$lib/net/fetch-with-timeout.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** fetch qui « pend » jusqu'à ce que son signal avorte (puis rejette AbortError). */
function stubHangingFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ),
  );
}

describe("clients géo — annulation externe (anti-course)", () => {
  it("fetchLots relève une AbortError quand le signal avorte", async () => {
    stubHangingFetch();
    const controller = new AbortController();
    const promise = fetchLots("delson", { baseUrl: "", signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
  });

  it("fetchGeoZones relève une AbortError quand le signal avorte", async () => {
    stubHangingFetch();
    const controller = new AbortController();
    const promise = fetchGeoZones("delson", { baseUrl: "", signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
  });

  it("fetchZones relève une AbortError quand le signal avorte", async () => {
    stubHangingFetch();
    const controller = new AbortController();
    const promise = fetchZones("delson", { baseUrl: "", signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
  });

  it("fetchSignalDetail relève une AbortError quand le signal avorte", async () => {
    stubHangingFetch();
    const controller = new AbortController();
    const promise = fetchSignalDetail("delson", "", { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
  });

  it("un signal déjà avorté court-circuite fetchLots sans appeler fetch", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchLots("delson", { baseUrl: "", signal: controller.signal }),
    ).rejects.toSatisfy(isAbortError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("clients géo — timeout (état d'erreur honnête)", () => {
  it("fetchLots lève RequestTimeoutError au-delà de timeoutMs", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const promise = fetchLots("delson", { baseUrl: "", timeoutMs: 3000 });
    const asserted = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(3000);
    await asserted;
  });

  it("fetchGeoZones lève RequestTimeoutError au-delà de timeoutMs", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const promise = fetchGeoZones("delson", { baseUrl: "", timeoutMs: 3000 });
    const asserted = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(3000);
    await asserted;
  });
});
