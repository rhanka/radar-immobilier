import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveMailerConfig,
  sendInvitationEmail,
  type MailerConfig,
} from "./mailer.js";

const TEM_CONFIG: MailerConfig = {
  temApiBaseUrl: "https://api.scaleway.com",
  temRegion: "fr-par",
  temProjectId: "09ac728a-e3b9-4a5b-9749-664b0f147c70",
  temFromEmail: "no-reply@sent-tech.ca",
  temFromName: "Radar",
  temSecretKey: "secret-token",
  appBaseUrl: "https://immo.sent-tech.ca",
};

describe("resolveMailerConfig", () => {
  it("maps the SCW_TEM_* env into a TEM mailer config", () => {
    const cfg = resolveMailerConfig({
      SCW_TEM_API_BASE_URL: "https://api.scaleway.com",
      SCW_TEM_REGION: "fr-par",
      SCW_TEM_PROJECT_ID: "proj-123",
      SCW_TEM_FROM_EMAIL: "no-reply@sent-tech.ca",
      SCW_TEM_FROM_NAME: "Radar",
      SCW_TEM_SECRET_KEY: "secret-token",
      AUTH_CALLBACK_BASE_URL: "https://immo.sent-tech.ca",
    } as NodeJS.ProcessEnv);

    expect(cfg.temApiBaseUrl).toBe("https://api.scaleway.com");
    expect(cfg.temRegion).toBe("fr-par");
    expect(cfg.temProjectId).toBe("proj-123");
    expect(cfg.temFromEmail).toBe("no-reply@sent-tech.ca");
    expect(cfg.temFromName).toBe("Radar");
    expect(cfg.temSecretKey).toBe("secret-token");
    expect(cfg.appBaseUrl).toBe("https://immo.sent-tech.ca");
  });

  it("defaults base url / region / from and leaves secret absent in degraded mode", () => {
    const cfg = resolveMailerConfig({} as NodeJS.ProcessEnv);
    expect(cfg.temApiBaseUrl).toBe("https://api.scaleway.com");
    expect(cfg.temRegion).toBe("fr-par");
    expect(cfg.temFromEmail).toBe("no-reply@sent-tech.ca");
    expect(cfg.temFromName).toBe("Radar");
    expect(cfg.temSecretKey).toBeUndefined();
  });
});

describe("sendInvitationEmail (Scaleway TEM HTTP API)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the TEM payload to the regional emails endpoint with the auth header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            emails: [{ id: "e1", message_id: "mid-1", status: "sending" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await sendInvitationEmail(
      { to: "user@example.com", token: "tok-123", invitedByName: "Alice" },
      TEM_CONFIG,
    );

    expect(result.sent).toBe(true);
    expect(result.link).toBe(
      "https://immo.sent-tech.ca/api/v1/auth/enroll?token=tok-123",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails",
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Auth-Token"]).toBe(
      "secret-token",
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const body = JSON.parse(init.body as string);
    expect(body.from).toEqual({
      email: "no-reply@sent-tech.ca",
      name: "Radar",
    });
    expect(body.to).toEqual([{ email: "user@example.com" }]);
    expect(body.project_id).toBe("09ac728a-e3b9-4a5b-9749-664b0f147c70");
    expect(body.subject).toBe("Invitation à rejoindre Radar Immobilier");
    expect(typeof body.text).toBe("string");
    expect(typeof body.html).toBe("string");
    // Lien d'enrôlement présent dans le corps texte.
    expect(body.text).toContain(
      "https://immo.sent-tech.ca/api/v1/auth/enroll?token=tok-123",
    );
  });

  it("omits project_id when none is configured", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ emails: [{ message_id: "mid-2" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const { temProjectId: _omit, ...noProject } = TEM_CONFIG;
    await sendInvitationEmail(
      { to: "user@example.com", token: "tok-456" },
      noProject,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.project_id).toBeUndefined();
  });

  it("falls back to log mode (sent=false) on a non-2xx TEM response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ message: "denied", type: "permissions_denied" }),
        { status: 403, statusText: "Forbidden" },
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await sendInvitationEmail(
      { to: "user@example.com", token: "tok-789" },
      TEM_CONFIG,
    );

    expect(result.sent).toBe(false);
    expect(result.link).toBe(
      "https://immo.sent-tech.ca/api/v1/auth/enroll?token=tok-789",
    );
    expect(warn).toHaveBeenCalled();
  });

  it("stays in degraded log mode when the TEM secret key is absent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { temSecretKey: _omit, ...noSecret } = TEM_CONFIG;
    const result = await sendInvitationEmail(
      { to: "user@example.com", token: "tok-degraded" },
      noSecret,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sent).toBe(false);
    expect(result.link).toBe(
      "https://immo.sent-tech.ca/api/v1/auth/enroll?token=tok-degraded",
    );
  });
});
