-- Migration 0009: table d'invitations par email (admin → user).
--
-- L'admin envoie une invitation à une adresse email. Le token d'invitation
-- est un secret opaque (random 32 bytes base64url). Quand le user invité
-- se logue via OIDC avec l'email correspondant, son compte est auto-approuvé
-- (matching par email dans auth.ts callback).
--
-- status :
--   'pending'  — invitation envoyée, en attente de login
--   'accepted' — le user s'est loggué, compte approuvé
--   'expired'  — token expiré (non utilisé dans ce premier lot, pour auditabilité)
--   'revoked'  — révoqué par un admin

--> statement-breakpoint
ALTER TABLE account_users
  DROP CONSTRAINT IF EXISTS account_users_status_check;
--> statement-breakpoint
ALTER TABLE account_users
  ADD CONSTRAINT account_users_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended', 'invited'));

--> statement-breakpoint
CREATE TABLE account_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,           -- secret opaque, base64url(32 bytes)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by TEXT NOT NULL,             -- sub de l'admin
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,               -- NULL = pas d'expiration définie
  note TEXT                             -- message facultatif de l'admin
);
--> statement-breakpoint
CREATE INDEX account_invitations_email_idx ON account_invitations(email);
--> statement-breakpoint
CREATE INDEX account_invitations_token_idx ON account_invitations(token);
--> statement-breakpoint
CREATE INDEX account_invitations_status_idx ON account_invitations(status);
--> statement-breakpoint
CREATE INDEX account_invitations_invited_by_idx ON account_invitations(invited_by);
