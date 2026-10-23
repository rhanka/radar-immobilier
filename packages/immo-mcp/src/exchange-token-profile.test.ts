import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import { validateExchangedToken } from "./exchange-token.js";

const now = 1_800_000_000;
const config = { issuer: "https://issuer.example.test", apiAudience: "https://api.example.test",
  workloadSub: "synthetic-workload", workloadClientId: "synthetic-workload" };
const subject = { sub: "synthetic-human", exp: now + 300, scopes: ["immo:search", "immo:read"] };
let publicKey: KeyLike;
let privateKey: KeyLike;
beforeAll(async () => { ({ publicKey, privateKey } = await generateKeyPair("RS256")); });
function mint(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: subject.sub, aud: config.apiAudience, iss: config.issuer,
    exp: now + 60, iat: now, scope: "immo:search", act: { sub: config.workloadSub },
    client_id: config.workloadClientId, ...overrides,
  }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).sign(privateKey);
}
async function verify(overrides: Record<string, unknown>) {
  return validateExchangedToken(await mint(overrides), subject, config, { resolveKey: async () => publicKey }, now);
}
describe("delegated issuer profile", () => {
  it.each([undefined, "", 4])("requires top-level client_id without actor fallback (%j)", async (client) => {
    await expect(verify({ client_id: client, act: { sub: config.workloadSub, client_id: config.workloadClientId } })).rejects.toThrow(/exchange_invalid_client/);
  });
  it("refuses additional subject-granted scopes outside the search-only profile", async () => {
    await expect(verify({ scope: "immo:search immo:read" })).rejects.toThrow(/exchange_scope_refused/);
  });
  it("refuses future issuance and expiry beyond the subject", async () => {
    await expect(verify({ iat: now + 1 })).rejects.toThrow(/exchange_invalid_lifetime/);
    await expect(verify({ iat: now + 10, exp: now + 301 })).rejects.toThrow(/exchange_invalid_lifetime/);
  });
});
