import { describe, expect, it } from "vitest";
import { requestTokenExchange } from "./exchange-client.js";

const input = { subjectToken: "synthetic-private-subject", audience: "https://api.example.test", scope: "immo:search",
  workload: { clientId: "synthetic-workload", clientSecret: "synthetic-secret" } };

describe("exchange response boundary", () => {
  it.each([undefined, "", [], "urn:invalid"])("refuses invalid issued_token_type %j", async (issued) => {
    await expect(requestTokenExchange("https://issuer.example.test/token", input, {
      fetchImpl: async () => Response.json({ access_token: "synthetic-delegation", token_type: "Bearer", issued_token_type: issued }),
    })).rejects.toThrow(/^exchange_invalid_token_type$/);
  });

  it("sanitizes network errors that include the original subject credential", async () => {
    const failure = requestTokenExchange("https://issuer.example.test/token", input, {
      fetchImpl: async () => { throw new Error(`failed body subject_token=${input.subjectToken}`); },
    });
    await expect(failure).rejects.toThrow(/^exchange_unavailable$/);
  });

  it.each(["null", "[]", "42"])("rejects non-object JSON %s with a bounded error", async (body) => {
    await expect(requestTokenExchange("https://issuer.example.test/token", input, {
      fetchImpl: async () => new Response(body),
    })).rejects.toThrow(/^exchange_invalid_response$/);
  });

  it("limits UTF-8 bytes while streaming and cancels an oversized response", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("é".repeat(9))); },
      cancel() { cancelled = true; },
    });
    await expect(requestTokenExchange("https://issuer.example.test/token", input, {
      maxBytes: 16, fetchImpl: async () => new Response(stream),
    })).rejects.toThrow(/^exchange_response_too_large$/);
    expect(cancelled).toBe(true);
  });
});
