import { describe, expect, it, vi } from "vitest";
import { createServiceTokenSource, FAIL_CLOSED_SERVICE_TOKEN, serviceTokenSource, SERVICE_SCOPE_BROKER } from "./service-token.js";

const ENDPOINT = "https://preprod.auth.sent-tech.ca/api/v1/auth/oauth/token";
const ok = (token: string, expires = 3600, scope: string = SERVICE_SCOPE_BROKER) =>
  new Response(JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: expires, scope }), { status: 200 });

describe("OAuth client_credentials service token", () => {
  it("requests the scope with client_credentials and caches the token until shortly before expiry", async () => {
    let now = 0;
    const fetcher = vi.fn().mockResolvedValueOnce(ok("t1", 120)).mockResolvedValueOnce(ok("t2", 120));
    const source = createServiceTokenSource({ tokenEndpoint: ENDPOINT, clientId: "immo-host", clientSecret: "secret",
      scope: SERVICE_SCOPE_BROKER, fetch: fetcher as never, now: () => now });
    expect(await source.authorization()).toBe("Bearer t1");
    now = 60_000;
    expect(await source.authorization()).toBe("Bearer t1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 95_000;
    expect(await source.authorization()).toBe("Bearer t2");
    const [url, init] = fetcher.mock.calls[0]! as [URL, RequestInit];
    expect(String(url)).toBe(ENDPOINT);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe(SERVICE_SCOPE_BROKER);
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("immo-host:secret").toString("base64")}`);
  });

  it("shares one in-flight request", async () => {
    let release!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const source = createServiceTokenSource({ tokenEndpoint: ENDPOINT, clientId: "c", clientSecret: "s", scope: "x", fetch: fetcher as never });
    const both = Promise.all([source.authorization(), source.authorization()]);
    release(ok("t", 3600, "x"));
    expect(await both).toEqual(["Bearer t", "Bearer t"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed and caches nothing on errors, a missing scope or an unconfigured client", async () => {
    for (const answer of [new Response("{}", { status: 401 }), ok("t", 0), ok("t", 3600, "other"),
      new Response(JSON.stringify({ access_token: "t", token_type: "mac", expires_in: 60 }), { status: 200 })]) {
      const source = createServiceTokenSource({ tokenEndpoint: ENDPOINT, clientId: "c", clientSecret: "s", scope: SERVICE_SCOPE_BROKER,
        fetch: (async () => answer) as never });
      await expect(source.authorization()).rejects.toMatchObject({ kind: "provider_unavailable" });
    }
    expect(serviceTokenSource({}, SERVICE_SCOPE_BROKER)).toBe(FAIL_CLOSED_SERVICE_TOKEN);
    await expect(FAIL_CLOSED_SERVICE_TOKEN.authorization()).rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(() => createServiceTokenSource({ tokenEndpoint: "http://idp", clientId: "c", clientSecret: "s", scope: "x" }))
      .toThrow("artifact_service_token_config_invalid");
  });
});
