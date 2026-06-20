// Service d'envoi d'email d'invitation.
//
// Mode SMTP réel : quand SMTP_HOST est configuré dans l'env, utilise un
// transport SMTP (via l'API native Node net/tls, ou via nodemailer si installé).
// Mode dégradé : si nodemailer n'est pas disponible ou SMTP_HOST absent,
// log le lien d'invitation sur stdout — la démo reste fonctionnelle sans config.
//
// Variables d'env optionnelles :
//   SMTP_HOST    — ex. smtp.sendgrid.net ou smtp.gmail.com
//   SMTP_PORT    — défaut 587
//   SMTP_USER    — identifiant SMTP
//   SMTP_PASS    — mot de passe SMTP (secret)
//   SMTP_FROM    — adresse expéditeur (défaut: noreply@sent-tech.ca)
//   APP_BASE_URL — URL de base de l'app (pour le lien dans l'email)

export interface MailerConfig {
  smtpHost?: string | undefined;
  smtpPort?: number | undefined;
  smtpUser?: string | undefined;
  smtpPass?: string | undefined;
  smtpFrom?: string | undefined;
  appBaseUrl?: string | undefined;
}

export interface InvitationEmailParams {
  to: string;
  token: string;
  invitedByName?: string | undefined;
}

/**
 * Résout la config mailer depuis les variables d'environnement.
 * Toutes les clés sont optionnelles : si SMTP_HOST est absent, mode dégradé.
 */
export function resolveMailerConfig(env: NodeJS.ProcessEnv = process.env): MailerConfig {
  const config: MailerConfig = {};
  const smtpHost = env["SMTP_HOST"];
  if (smtpHost) config.smtpHost = smtpHost;
  const smtpPort = env["SMTP_PORT"];
  config.smtpPort = smtpPort ? parseInt(smtpPort, 10) : 587;
  const smtpUser = env["SMTP_USER"];
  if (smtpUser) config.smtpUser = smtpUser;
  const smtpPass = env["SMTP_PASS"];
  if (smtpPass) config.smtpPass = smtpPass;
  config.smtpFrom = env["SMTP_FROM"] || "noreply@sent-tech.ca";
  config.appBaseUrl =
    env["AUTH_CALLBACK_BASE_URL"] || env["APP_BASE_URL"] || "http://localhost:5173";
  return config;
}

/**
 * Envoie un email d'invitation.
 *
 * Tente d'abord via nodemailer si SMTP_HOST est configuré.
 * En cas d'absence de nodemailer ou de config SMTP, log le lien sur stdout
 * (mode dégradé pour la démo — ne bloque pas).
 *
 * Retourne { sent: true } si l'email part réellement,
 *           { sent: false, link } si mode dégradé (lien loggué).
 */
export async function sendInvitationEmail(
  params: InvitationEmailParams,
  config: MailerConfig,
): Promise<{ sent: boolean; link: string }> {
  const appBase = (config.appBaseUrl ?? "").replace(/\/$/, "");
  const link = `${appBase}/enroll?token=${encodeURIComponent(params.token)}`;

  const subject = "Invitation à rejoindre Radar Immobilier";
  const bodyOpts: { link: string; invitedByName?: string } = { link };
  if (params.invitedByName) bodyOpts.invitedByName = params.invitedByName;
  const body = buildEmailBody(bodyOpts);

  // Mode SMTP réel — tente nodemailer
  if (config.smtpHost) {
    try {
      // Import dynamique : nodemailer n'est pas dans les deps core
      // Si absent, on tombera dans le catch et loggera le lien
      const nodemailer = await import("nodemailer" as string);
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort ?? 587,
        secure: (config.smtpPort ?? 587) === 465,
        auth:
          config.smtpUser && config.smtpPass
            ? { user: config.smtpUser, pass: config.smtpPass }
            : undefined,
      });

      await transporter.sendMail({
        from: config.smtpFrom,
        to: params.to,
        subject,
        text: body.text,
        html: body.html,
      });

      return { sent: true, link };
    } catch (err) {
      // nodemailer absent ou erreur SMTP → mode dégradé
      console.warn(
        `[mailer] SMTP unavailable (${String(err)}). Falling back to log mode.`,
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
