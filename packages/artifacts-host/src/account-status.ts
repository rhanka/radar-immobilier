export interface AccountStatusQueryable {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ readonly rows: ReadonlyArray<{ readonly status: string }> }>;
}

export async function readAccountStatus(
  db: AccountStatusQueryable,
  sub: string,
): Promise<string | null> {
  const res = await db.query("SELECT status FROM account_users WHERE sub = $1 LIMIT 1", [sub]);
  const row = res.rows[0];
  return row ? row.status : null;
}

export function isApprovedAccountStatus(status: string | null): boolean {
  return status === "approved";
}
