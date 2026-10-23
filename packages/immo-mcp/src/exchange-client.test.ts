import { describe, expect, it, vi } from "vitest";
import { requestTokenExchange } from "./exchange-client.js";

const ENDPOINT = "https://exchange.test.local/token";
const INPUT = { subjectToken: "subject-1", scope: "immo:search", audience: "https://immo.test.local",
  workload: { clientId: "synthetic:client", clientSecret: "synthetic:key/secret" } };

function okResponse(payload: unknown): Response {
  return Response.json(payload);
}

describe("requestTokenExchange", () => {
  it("posts the RFC 8693 grant with audience and scope", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ access_token: "ex-1", token_type: "Bearer", issued_token_type: "urn:ietf:params:oauth:token-type:access_token" }));
    await requestTokenExchange(ENDPOINT, INPUT, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Basic ${Buffer.from("synthetic%3Aclient:synthetic%3Akey%2Fsecret").toString("base64")}`);
    expect(String(init.body)).not.toContain("client_secret");
    expect(String(init.body)).not.toContain("actor_token");
    expect(String(init.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange");
    expect(String(init.body)).toContain("audience=" + encodeURIComponent(INPUT.audience));
    expect(String(init.body)).toContain("scope=immo%3Asearch");
  });

  it("refuses redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response("moved", { status: 302 }));
    await expect(requestTokenExchange(ENDPOINT, INPUT, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/exchange_redirect_refused/);
  });

  it("refuses oversized responses", async () => {
    const big = "x".repeat(17 * 1024);
    const fetchImpl = vi.fn(async () => new Response(big, { status: 200 }));
    await expect(requestTokenExchange(ENDPOINT, INPUT, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/exchange_response_too_large/);
  });

  it("refuses refresh tokens and identity tokens", async () => {
    for (const payload of [
      { access_token: "ex-1", token_type: "Bearer", refresh_token: "r-1" },
      { access_token: "ex-1", token_type: "Bearer", id_token: "id-1" },
    ]) {
      const fetchImpl = vi.fn(async () => okResponse(payload));
      await expect(requestTokenExchange(ENDPOINT, INPUT, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/exchange_refresh_token_refused/);
    }
  });

  it("refuses missing credentials and HTTP errors without retry", async () => {
    const missing = vi.fn(async () => okResponse({ token_type: "Bearer", issued_token_type: "urn:ietf:params:oauth:token-type:access_token" }));
    await expect(requestTokenExchange(ENDPOINT, INPUT, { fetchImpl: missing as unknown as typeof fetch })).rejects.toThrow(/exchange_invalid_response/);
    const failing = vi.fn(async () => new Response("denied", { status: 400 }));
    await expect(requestTokenExchange(ENDPOINT, INPUT, { fetchImpl: failing as unknown as typeof fetch })).rejects.toThrow(/exchange_http_error:400/);
    expect(missing).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
