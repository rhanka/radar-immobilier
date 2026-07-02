/**
 * Tests fetch-with-timeout — borne temporelle + annulation externe.
 *
 * Prouve les 3 propriétés qui corrigent le bug des vues carte :
 *  1. chemin nominal : passe la Response telle quelle (ISO) ;
 *  2. timeout dépassé → RequestTimeoutError (état d'erreur honnête, pas de
 *     spinner éternel) ;
 *  3. abort externe → AbortError d'origine relevée (réponse à IGNORER, distincte
 *     d'un timeout).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchWithTimeout,
  RequestTimeoutError,
  isAbortError,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "./fetch-with-timeout.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout — chemin nominal", () => {
  it("relaie la Response quand fetch répond avant le timeout", async () => {
    const body = JSON.stringify({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const res = await fetchWithTimeout("/api/x", { timeoutMs: 1000 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("transmet le signal du controller interne à fetch", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await fetchWithTimeout("/api/x");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("expose un délai par défaut raisonnable", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("fetchWithTimeout — timeout", () => {
  it("lève RequestTimeoutError quand fetch dépasse timeoutMs", async () => {
    vi.useFakeTimers();
    // fetch qui ne résout jamais tant que son signal n'avorte pas.
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
    const promise = fetchWithTimeout("/api/slow", { timeoutMs: 5000 });
    // Attache un catch tôt pour éviter un unhandled rejection pendant l'avance.
    const asserted = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await asserted;
  });

  it("le message du timeout porte le délai et l'URL", async () => {
    vi.useFakeTimers();
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
    const promise = fetchWithTimeout("/api/geo/x/zones", { timeoutMs: 2000 });
    const asserted: Promise<unknown> = promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const err = await asserted;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    const timeoutErr = err as RequestTimeoutError;
    expect(timeoutErr.message).toContain("2000ms");
    expect(timeoutErr.message).toContain("/api/geo/x/zones");
    expect(timeoutErr.timeoutMs).toBe(2000);
  });
});

describe("fetchWithTimeout — annulation externe (anti-course)", () => {
  it("relève une AbortError quand le signal externe avorte", async () => {
    const controller = new AbortController();
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
    const promise = fetchWithTimeout("/api/x", { signal: controller.signal, timeoutMs: 10_000 });
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
  });

  it("court-circuite immédiatement si le signal externe est déjà avorté", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithTimeout("/api/x", { signal: controller.signal }),
    ).rejects.toSatisfy(isAbortError);
    // fetch ne doit JAMAIS être appelé sur un signal déjà avorté.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isAbortError distingue abort et timeout", () => {
    const abort = new Error("x");
    abort.name = "AbortError";
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new RequestTimeoutError("/x", 1))).toBe(false);
    expect(isAbortError(new Error("plain"))).toBe(false);
  });
});
