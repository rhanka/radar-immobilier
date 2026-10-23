import { describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import type { KeyLike } from "jose";
import { validateExchangedToken } from "./exchange-token.js";
import {
  TEST_API_AUDIENCE,
  TEST_ISSUER,
  TEST_WORKLOAD_CLIENT,
  TEST_WORKLOAD_SUB,
} from "./test-exchange-fixtures.js";

const SUBJECT = { sub: "user-1", exp: Math.floor(Date.now() / 1000) + 300, scopes: ["immo:read", "immo:search"] };
const CONFIG = {
  issuer: TEST_ISSUER,
  apiAudience: TEST_API_AUDIENCE,
  workloadSub: TEST_WORKLOAD_SUB,
  workloadClientId: TEST_WORKLOAD_CLIENT,
};

async function mint(key: KeyLike, claims: Record<string, unknown>, expIn = 60, sub = "user-1"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "RS256", typ: "at+jwt" })
    .setIssuer(TEST_ISSUER)
    .setSubject(sub)
    .setAudience(TEST_API_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expIn)
    .sign(key);
}

describe("validateExchangedToken", () => {
  it("accepts a well-formed delegated token and retains the human", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const token = await mint(privateKey as KeyLike, {
      scope: "immo:search",
      client_id: TEST_WORKLOAD_CLIENT,
      act: { sub: TEST_WORKLOAD_SUB },
    });
    const out = await validateExchangedToken(token, SUBJECT, CONFIG, { resolveKey: async () => publicKey as KeyLike });
    expect(out.sub).toBe("user-1");
    expect(out.actSub).toBe(TEST_WORKLOAD_SUB);
    expect(out.scopes).toContain("immo:search");
  });

  it("refuses wrong audience, subject, actor, client and scope", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const key = { resolveKey: async () => publicKey as KeyLike };
    const base = { scope: "immo:search", client_id: TEST_WORKLOAD_CLIENT, act: { sub: TEST_WORKLOAD_SUB } };
    const wrongAud = await new SignJWT(base).setProtectedHeader({ alg: "RS256" }).setIssuer(TEST_ISSUER).setSubject("user-1").setAudience("https://evil.test").setIssuedAt().setExpirationTime("60s").sign(privateKey);
    await expect(validateExchangedToken(wrongAud, SUBJECT, CONFIG, key)).rejects.toThrow(/exchange_invalid_audience/);
    const wrongSub = await mint(privateKey as KeyLike, { ...base });
    await expect(validateExchangedToken(wrongSub, { ...SUBJECT, sub: "user-2" }, CONFIG, key)).rejects.toThrow(/exchange_invalid_subject/);
    const wrongAct = await mint(privateKey as KeyLike, { scope: "immo:search", client_id: TEST_WORKLOAD_CLIENT, act: { sub: "evil-workload" } });
    await expect(validateExchangedToken(wrongAct, SUBJECT, CONFIG, key)).rejects.toThrow(/exchange_invalid_actor/);
    const wrongClient = await mint(privateKey as KeyLike, { scope: "immo:search", client_id: "evil", act: { sub: TEST_WORKLOAD_SUB } });
    await expect(validateExchangedToken(wrongClient, SUBJECT, CONFIG, key)).rejects.toThrow(/exchange_invalid_client/);
    const wrongScope = await mint(privateKey as KeyLike, { scope: "immo:read", client_id: TEST_WORKLOAD_CLIENT, act: { sub: TEST_WORKLOAD_SUB } });
    await expect(validateExchangedToken(wrongScope, SUBJECT, CONFIG, key)).rejects.toThrow(/exchange_scope_refused/);
  });

  it("refuses service users, broad scopes, long lifetimes and proof binding", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const key = { resolveKey: async () => publicKey as KeyLike };
    const service = await mint(privateKey as KeyLike, { scope: "immo:search", client_id: TEST_WORKLOAD_CLIENT, act: { sub: TEST_WORKLOAD_SUB } }, 60, TEST_WORKLOAD_SUB);
    await expect(validateExchangedToken(service, { ...SUBJECT, sub: TEST_WORKLOAD_SUB }, CONFIG, key)).rejects.toThrow(/exchange_service_user_refused/);
    const broad = await mint(privateKey as KeyLike, { scope: "immo:search immo:admin", client_id: TEST_WORKLOAD_CLIENT, act: { sub: TEST_WORKLOAD_SUB } });
    await expect(validateExchangedToken(broad, SUBJECT, CONFIG, key)).rejects.toThrow(/exchange_scope_refused/);
    const long = await mint(privateKey as KeyLike, { scope: "immo:search", client_id: TEST_WORKLOAD_CLIENT, act: { sub: TEST_WORKLOAD_SUB } }, 301);
    await expect(validateExchangedToken(long, { ...SUBJECT, exp: Math.floor(Date.now() / 1000) + 900 }, CONFIG, key)).rejects.toThrow(/exchange_invalid_lifetime/);
    const bound = await mint(privateKey as KeyLike, { scope: "immo:search", client_id: TEST_WORKLOAD_CLIENT, act: { sub: TEST_WORKLOAD_SUB }, cnf: { jkt: "abc" } });
    await expect(validateExchangedToken(bound, SUBJECT, CONFIG, key)).rejects.toThrow(/exchange_proof_binding_refused/);
  });
});
