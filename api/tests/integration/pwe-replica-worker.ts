import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { schema } from "../../src/db/schema.js";
import { coordinateSignalWrite } from "../../src/services/facets/signal-write-admission.js";
import { createDurableWriteAdmission } from "../../src/services/facets/pw-write-admission-durable.js";
import type { SignalWriteInput } from "../../src/services/facets/signal-write-operations.js";
import type { PwConfirmation } from "../../src/services/facets/pw-write-confirmation.js";

type Start = { database: string; sub: string; intentId: string; input: SignalWriteInput;
  confirmation: PwConfirmation; hold: "record" | "reserve"; rollback: boolean };
let release!: () => void;
const gate = new Promise<void>((resolve) => { release = resolve; });
let running = false;
process.on("message", (message: Start | "release") => {
  if (message === "release") { release(); return; }
  if (running) throw new Error("Replica accepts one confirmation only");
  running = true;
  void execute(message);
});

async function execute(message: Start) {
  const pool = new pg.Pool({ host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? "5432"), user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD, database: message.database, max: 2 });
  const db = drizzle(pool, { schema });
  let writes = 0;
  const port = createDurableWriteAdmission(message.intentId, { confirmation: message.confirmation });
  const record = port.recordCommit;
  port.recordCommit = async (tx, result) => { writes++; await record(tx, result); };
  const pause = async (tx: Parameters<typeof port.reserve>[0]) => {
    const result = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    process.send!({ kind: "held", pid: result.rows[0]!.pid });
    await gate;
    if (message.rollback) throw new Error("PWE replica rollback");
  };
  if (message.hold === "record") {
    const hook = port.recordCommit;
    port.recordCommit = async (tx, result) => { await hook(tx, result); await pause(tx); };
  } else {
    const hook = port.reserve;
    port.reserve = async (tx, reservation) => { await hook(tx, reservation); await pause(tx); };
  }
  try {
    await coordinateSignalWrite(db, message.sub, message.input, port);
    process.send!({ kind: "done", committed: true, writes });
  } catch (error) {
    process.send!({ kind: "done", committed: false, writes,
      error: error instanceof Error ? error.message : "unexpected failure" });
  } finally {
    await pool.end(); process.disconnect!();
  }
}
process.send!({ kind: "ready", processId: process.pid });
