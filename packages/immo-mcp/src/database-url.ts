/**
 * Role URLs (artifact writer, account reader) are minted once, but the preprod
 * cutover alternates the live database between `radar` and `radar_next` by
 * patching only `radar-db-credentials.POSTGRES_DB`. The Deployment maps that key
 * (optional) to IMMO_MCP_DATABASE_NAME so both role URLs follow the selected
 * database after the cutover restart. Without the variable, each URL keeps its
 * own database name.
 */
const MAX_IDENTIFIER_BYTES = 63; // PostgreSQL NAMEDATALEN - 1

export function bindDatabaseName(url: string, database: string | undefined): string {
  if (database === undefined || database === "") return url;
  if (Buffer.byteLength(database, "utf8") > MAX_IDENTIFIER_BYTES || /[/?#\0]/.test(database)) {
    throw new Error("database_name_invalid");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("database_url_invalid");
  // encodeURI keeps path-legal reserved characters, which pg's decodeURI restores verbatim.
  parsed.pathname = `/${encodeURI(database)}`;
  if (decodeURI(parsed.pathname.slice(1)) !== database) throw new Error("database_name_invalid");
  return parsed.toString();
}
