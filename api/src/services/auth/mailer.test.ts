import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMailerConfig, sendInvitationEmail } from "./mailer.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveMailerConfig", () => {
  it("prefers the public auth callback URL", () => {
    expect(
      resolveMailerConfig({
        AUTH_CALLBACK_BASE_URL: "https://immo.sent-tech.ca",
        APP_BASE_URL: "https://fallback.example.com",
      } as NodeJS.ProcessEnv),
    ).toEqual({ appBaseUrl: "https://immo.sent-tech.ca" });
  });

  it("falls back to the local application URL", () => {
    expect(resolveMailerConfig({} as NodeJS.ProcessEnv)).toEqual({
      appBaseUrl: "http://localhost:5173",
    });
  });
});

describe("sendInvitationEmail", () => {
  it("logs the enrolment link without calling an external provider", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await sendInvitationEmail(
      { to: "user@example.com", token: "tok-123", invitedByName: "Alice" },
      { appBaseUrl: "https://immo.sent-tech.ca" },
    );

    expect(result).toEqual({
      sent: false,
      link: "https://immo.sent-tech.ca/api/v1/auth/enroll?token=tok-123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "[invitation] Lien d'invitation pour user@example.com : " +
        "https://immo.sent-tech.ca/api/v1/auth/enroll?token=tok-123",
    );
  });
});
