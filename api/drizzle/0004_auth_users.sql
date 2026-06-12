-- Migration 0004: account users for OIDC enrolment + admin approval workflow.
--
-- account_users tracks every user who has completed at least one OIDC login.
-- status = 'pending' on first login; an admin moves it to 'approved'/'rejected'.
-- The first login of admin@sent-tech.ca auto-approves (is_admin = TRUE).

CREATE TABLE account_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub TEXT NOT NULL UNIQUE,        -- IdP subject (stable id)
  email TEXT,                      -- from IdP id_token
  name TEXT,                       -- from IdP id_token
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT                 -- sub de l'admin qui a approuvé
);

CREATE INDEX account_users_sub_idx ON account_users(sub);
CREATE INDEX account_users_status_idx ON account_users(status);
