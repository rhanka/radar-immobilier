import { describe, it, expect } from "vitest";
import { chatRoute } from "./chat.js";
import {
  isConfiguredProvider,
  listConfiguredProviders,
} from "../services/chat/mesh-runtime.js";

describe("mesh-runtime provider configuration", () => {
  it("reports no providers when no key is set", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(listConfiguredProviders(env)).toEqual([]);
  });

  it("lists only providers with a non-empty key, neutral alphabetical order", () => {
    const env = {
      OPENAI_API_KEY: "x",
      COHERE_API_KEY: "  ", // whitespace only -> not configured
      ANTHROPIC_API_KEY: "y",
    } as NodeJS.ProcessEnv;
    const ids = listConfiguredProviders(env).map((p) => p.providerId);
    expect(ids).toEqual(["anthropic", "openai"]);
  });

  it("accepts GOOGLE_API_KEY as a Gemini alias", () => {
    const env = { GOOGLE_API_KEY: "g" } as NodeJS.ProcessEnv;
    expect(isConfiguredProvider("gemini", env)).toBe(true);
  });

  it("treats an unknown provider id as not configured", () => {
    const env = { OPENAI_API_KEY: "x" } as NodeJS.ProcessEnv;
    expect(isConfiguredProvider("notaprovider", env)).toBe(false);
  });
});

describe("chat route", () => {
  it("GET /api/chat/providers reports the unconfigured state when no key is set", async () => {
    // The test environment has no provider keys.
    const app = chatRoute();
    const res = await app.request("/api/chat/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: unknown[];
      configured: boolean;
    };
    expect(body.configured).toBe(false);
    expect(body.providers).toEqual([]);
  });

  it("POST /api/chat/messages rejects an unconfigured provider with 400", async () => {
    const app = chatRoute();
    const res = await app.request("/api/chat/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "openai",
        messages: [{ role: "user", content: "Bonjour" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/chat/messages validates the request body", async () => {
    const app = chatRoute();
    const res = await app.request("/api/chat/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "openai" }),
    });
    expect(res.status).toBe(400);
  });
});
