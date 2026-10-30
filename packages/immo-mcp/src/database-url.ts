/**
 * Role URLs (artifact writer, account reader) are minted once, but the preprod
 * cutover alternates the live database between `radar` and `radar_next` by
 * patching only `radar-db-credentials.POSTGRES_DB`. The Deployment maps that key
 * to IMMO_MCP_DATABASE_NAME so both role URLs follow the selected database after
 * the cutover restart, instead of staying on the previous one.
 */
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function bindDatabaseName(url: string, database: string | undefined): string {
  const name = database?.trim();
  if (!name) return url;
  if (!DATABASE_NAME.test(name)) throw new Error("database_name_invalid");
  const parsed = new URL(url);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("database_url_invalid");
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
