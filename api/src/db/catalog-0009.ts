import { createHash } from "node:crypto";
import type pg from "pg";

/** Catalog-only evidence for the documented manual migration; never reads invitation data. */
export async function qualify0009Catalog(client: pg.PoolClient): Promise<string> {
  const columns = await client.query<{ signature: string }>(`
    SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
      a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS signature
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.account_invitations'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`);
  const expectedColumns = [
    "id:uuid:true:gen_random_uuid()", "email:text:true:", "token:text:true:",
    "status:text:true:'pending'::text", "invited_by:text:true:",
    "invited_at:timestamp with time zone:true:now()", "accepted_at:timestamp with time zone:false:",
    "expires_at:timestamp with time zone:false:", "note:text:false:",
  ];
  const constraints = await client.query<{ signature: string }>(`
    SELECT conname || ':' || pg_get_constraintdef(oid) AS signature FROM pg_constraint
    WHERE conrelid = 'public.account_invitations'::regclass OR
      (conrelid = 'public.account_users'::regclass AND conname = 'account_users_status_check')
    ORDER BY conname`);
  const expectedConstraints = [
    "account_invitations_pkey:PRIMARY KEY (id)",
    "account_invitations_status_check:CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])))",
    "account_invitations_token_key:UNIQUE (token)",
    "account_users_status_check:CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text, 'invited'::text])))",
  ];
  const indexes = await client.query<{ indexdef: string }>(`
    SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'account_invitations'
    ORDER BY indexname`);
  const expectedIndexes = [
    "CREATE INDEX account_invitations_email_idx ON public.account_invitations USING btree (email)",
    "CREATE INDEX account_invitations_invited_by_idx ON public.account_invitations USING btree (invited_by)",
    "CREATE UNIQUE INDEX account_invitations_pkey ON public.account_invitations USING btree (id)",
    "CREATE INDEX account_invitations_status_idx ON public.account_invitations USING btree (status)",
    "CREATE INDEX account_invitations_token_idx ON public.account_invitations USING btree (token)",
    "CREATE UNIQUE INDEX account_invitations_token_key ON public.account_invitations USING btree (token)",
  ];
  const actual = [columns.rows.map((r) => r.signature), constraints.rows.map((r) => r.signature),
    indexes.rows.map((r) => r.indexdef)];
  if (JSON.stringify(actual) !== JSON.stringify([expectedColumns, expectedConstraints, expectedIndexes])) {
    throw new Error("0009 catalog does not match the immutable migration; refusing attestation");
  }
  return createHash("sha256").update(JSON.stringify(actual)).digest("hex");
}
