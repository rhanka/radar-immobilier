// Invitation-link delivery boundary. No external mail provider is configured:
// the API logs the enrolment link so the admin UI can expose it without making
// a network call to a retired service.

export interface MailerConfig {
  appBaseUrl?: string | undefined;
}

export interface InvitationEmailParams {
  to: string;
  token: string;
  invitedByName?: string | undefined;
}

/** Resolve the public application base URL used in invitation links. */
export function resolveMailerConfig(env: NodeJS.ProcessEnv = process.env): MailerConfig {
  return {
    appBaseUrl:
      env["AUTH_CALLBACK_BASE_URL"] || env["APP_BASE_URL"] || "http://localhost:5173",
  };
}

/** Log the invitation link until a replacement delivery provider is selected. */
export async function sendInvitationEmail(
  params: InvitationEmailParams,
  config: MailerConfig,
): Promise<{ sent: boolean; link: string }> {
  const appBase = (config.appBaseUrl ?? "").replace(/\/$/, "");
  // The enrolment link enters through the API gate, which clears any residual
  // session and forces the OIDC flow before an invitation can be consumed.
  const link = `${appBase}/api/v1/auth/enroll?token=${encodeURIComponent(params.token)}`;

  console.info(`[invitation] Lien d'invitation pour ${params.to} : ${link}`);
  return { sent: false, link };
}
