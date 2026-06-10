import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

/** All env-var names read by mesh-runtime to detect configured providers. */
const PROVIDER_KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
] as const;

describe("chat route", () => {
  // Ensure the "unconfigured" tests are independent of whatever provider keys
  // happen to be present in the host environment (docker-compose passes the
  // .env keys into the container). We stub every key to an empty string before
  // each test and restore the original values afterwards.
  beforeEach(() => {
    for (const key of PROVIDER_KEY_VARS) {
      vi.stubEnv(key, "");
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET /api/chat/providers reports the unconfigured state when no key is set", async () => {
    // Provider keys are stubbed to empty in beforeEach — always unconfigured.
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
