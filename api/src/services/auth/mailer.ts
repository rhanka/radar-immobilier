// Service d'envoi d'email d'invitation.
//
// Mode TEM réel : quand SCW_TEM_SECRET_KEY est configuré dans l'env, envoie le
// courriel via l'API HTTP Scaleway Transactional Email (TEM) — fetch natif, pas
// de dépendance SMTP. L'egress SMTP est BLOQUÉ au niveau plateforme sur ce
// cluster (BR-37b), donc le relais nodemailer/smtp.tem.scw.cloud:587 ne délivre
// jamais ; on appelle l'API HTTP TEM, exactement comme sentropic.
// Mode dégradé : si SCW_TEM_SECRET_KEY est absent, log le lien d'invitation sur
// stdout — la démo reste fonctionnelle sans config (lien copiable depuis l'UI).
//
// Variables d'env (résolues dans config.ts → resolveMailerConfig) :
//   SCW_TEM_API_BASE_URL — défaut https://api.scaleway.com
//   SCW_TEM_REGION       — défaut fr-par
//   SCW_TEM_PROJECT_ID   — id du projet SCW (requis côté API)
//   SCW_TEM_FROM_EMAIL   — adresse expéditeur (défaut no-reply@sent-tech.ca)
//   SCW_TEM_FROM_NAME    — nom expéditeur (défaut Radar)
//   SCW_TEM_SECRET_KEY   — clé secrète d'API TEM (X-Auth-Token). Absente → dégradé.
//   APP_BASE_URL         — URL de base de l'app (pour le lien dans l'email)

export interface MailerConfig {
  /** Base de l'API SCW (ex. https://api.scaleway.com). */
  temApiBaseUrl?: string | undefined;
  /** Région TEM (ex. fr-par). */
  temRegion?: string | undefined;
  /** Id du projet SCW. */
  temProjectId?: string | undefined;
  /** Adresse expéditeur. */
  temFromEmail?: string | undefined;
  /** Nom expéditeur. */
  temFromName?: string | undefined;
  /** Clé secrète d'API TEM (X-Auth-Token). Absente → mode dégradé. */
  temSecretKey?: string | undefined;
  appBaseUrl?: string | undefined;
}

export interface InvitationEmailParams {
  to: string;
  token: string;
  invitedByName?: string | undefined;
}

/**
 * Résout la config mailer depuis les variables d'environnement.
 * Toutes les clés sont optionnelles : si SCW_TEM_SECRET_KEY est absent, mode dégradé.
 */
export function resolveMailerConfig(env: NodeJS.ProcessEnv = process.env): MailerConfig {
  const config: MailerConfig = {};
  config.temApiBaseUrl = env["SCW_TEM_API_BASE_URL"] || "https://api.scaleway.com";
  config.temRegion = env["SCW_TEM_REGION"] || "fr-par";
  const temProjectId = env["SCW_TEM_PROJECT_ID"];
  if (temProjectId) config.temProjectId = temProjectId;
  config.temFromEmail = env["SCW_TEM_FROM_EMAIL"] || "no-reply@sent-tech.ca";
  config.temFromName = env["SCW_TEM_FROM_NAME"] || "Radar";
  const temSecretKey = env["SCW_TEM_SECRET_KEY"];
  if (temSecretKey) config.temSecretKey = temSecretKey;
  config.appBaseUrl =
    env["AUTH_CALLBACK_BASE_URL"] || env["APP_BASE_URL"] || "http://localhost:5173";
  return config;
}

interface TemSuccessResponse {
  emails?: Array<{
    id?: string;
    message_id?: string;
    status?: string;
  }>;
}

/**
 * Envoie un email d'invitation.
 *
 * Mode TEM réel : quand `temSecretKey` est présent, POST vers l'API HTTP
 * Scaleway Transactional Email (le seul transport qui délivre ici — l'egress
 * SMTP est bloqué au niveau plateforme). En cas d'absence de clé ou d'erreur
 * réseau/API, log le lien sur stdout (mode dégradé pour la démo — ne bloque pas).
 *
 * Retourne { sent: true } si l'email part réellement,
 *           { sent: false, link } si mode dégradé (lien loggué).
 */
export async function sendInvitationEmail(
  params: InvitationEmailParams,
  config: MailerConfig,
): Promise<{ sent: boolean; link: string }> {
  const appBase = (config.appBaseUrl ?? "").replace(/\/$/, "");
  // SÉCURITÉ : le lien d'invitation entre par le sas API `/api/v1/auth/enroll`,
  // PAS par une route SPA. Le sas détruit toute session résiduelle puis force
  // le flux OIDC (auth device sur l'IdP sentropic) — un lien d'invitation ne
  // peut donc jamais réutiliser un cookie existant ni accorder un accès sans
  // authentification réelle. Le `token` reste en query pour la traçabilité ;
  // l'invitation est matchée par email côté callback (le token n'est pas le
  // secret d'authentification).
  const link = `${appBase}/api/v1/auth/enroll?token=${encodeURIComponent(params.token)}`;

  const subject = "Invitation à rejoindre Radar Immobilier";
  const bodyOpts: { link: string; invitedByName?: string } = { link };
  if (params.invitedByName) bodyOpts.invitedByName = params.invitedByName;
  const body = buildEmailBody(bodyOpts);

  // Mode TEM réel — POST vers l'API HTTP Scaleway Transactional Email.
  if (config.temSecretKey) {
    try {
      const baseUrl = (config.temApiBaseUrl ?? "https://api.scaleway.com").replace(
        /\/$/,
        "",
      );
      const region = config.temRegion ?? "fr-par";
      const url = `${baseUrl}/transactional-email/v1alpha1/regions/${region}/emails`;

      const payload = {
        from: {
          email: config.temFromEmail ?? "no-reply@sent-tech.ca",
          name: config.temFromName ?? "Radar",
        },
        to: [{ email: params.to }],
        subject,
        text: body.text,
        html: body.html,
        ...(config.temProjectId ? { project_id: config.temProjectId } : {}),
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Auth-Token": config.temSecretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        throw new Error(
          `Scaleway TEM send failed: HTTP ${response.status} ${response.statusText} - ${raw.slice(0, 500)}`,
        );
      }

      // Drain la réponse (id/message_id) sans la rendre obligatoire.
      await response
        .json()
        .then((d) => d as TemSuccessResponse)
        .catch(() => undefined);

      return { sent: true, link };
    } catch (err) {
      // Erreur réseau / API TEM → mode dégradé
      console.warn(
        `[mailer] Scaleway TEM unavailable (${String(err)}). Falling back to log mode.`,
      );
    }
  }

  // Mode dégradé : log le lien d'invitation
  console.info(
    `[invitation] Lien d'invitation pour ${params.to} : ${link}`,
  );
  return { sent: false, link };
}

interface EmailContent {
  text: string;
  html: string;
}

function buildEmailBody(opts: {
  link: string;
  invitedByName?: string;
}): EmailContent {
  const who = opts.invitedByName ? ` par ${opts.invitedByName}` : "";

  const text = [
    `Bonjour,`,
    ``,
    `Vous avez été invité${who} à rejoindre Radar Immobilier.`,
    ``,
    `Pour activer votre compte, cliquez sur le lien ci-dessous (ou copiez-le`,
    `dans votre navigateur) et authentifiez-vous avec le courriel invité :`,
    ``,
    `  ${opts.link}`,
    ``,
    `Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message.`,
    ``,
    `— L'équipe Radar Immobilier`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Invitation Radar Immobilier</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h2 style="margin-bottom:8px">Invitation à rejoindre Radar Immobilier</h2>
  <p>Bonjour,</p>
  <p>Vous avez été invité${who} à rejoindre <strong>Radar Immobilier</strong>.</p>
  <p>Pour activer votre compte, cliquez sur le bouton ci-dessous et authentifiez-vous
     avec le courriel invité :</p>
  <p style="margin:24px 0">
    <a href="${opts.link}"
       style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;
              text-decoration:none;font-weight:600;display:inline-block">
      Activer mon compte
    </a>
  </p>
  <p style="color:#64748b;font-size:0.9em">
    Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
    <a href="${opts.link}" style="color:#2563eb">${opts.link}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
  <p style="color:#94a3b8;font-size:0.85em">
    Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message.
  </p>
</body>
</html>`;

  return { text, html };
}
