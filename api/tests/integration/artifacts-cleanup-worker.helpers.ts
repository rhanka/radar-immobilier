import pg from "pg";

// A real leased SQL connection holds pool.end; no provider facade is simulated.
if (process.argv[2] === "--cleanup-worker") {
  const pool = new pg.Pool({ host: process.env.POSTGRES_HOST,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB });
  const client = await pool.connect();
  const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
  const stuck = process.argv[3] === "stuck";
  if (stuck) process.on("SIGTERM", () => {});
  process.on("message", async () => {
    if (!stuck) client.release();
    await pool.end();
    process.send?.("closed");
    process.disconnect?.();
  });
  process.send?.(pid);
}
