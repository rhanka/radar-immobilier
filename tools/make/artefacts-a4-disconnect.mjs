import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

/** Terminate the real child MCP's backend, never the probe's administrative connection. */
export async function exerciseDisconnects({ db, child, call, readCount }) {
  const activity = async (active = false) => (await db.query(
    `SELECT pid FROM pg_stat_activity WHERE application_name = 'a4-mcp-account'
     AND datname = current_database() AND state = $1 ${active ? "AND wait_event_type = 'Lock'" : ''}`,
    [active ? 'active' : 'idle'],
  )).rows;
  const terminate = async (pid) => {
    assert.equal((await db.query('SELECT pg_terminate_backend($1) AS killed', [pid])).rows[0].killed, true);
  };
  const alive = () => {
    assert.equal(child.exitCode, null, 'MCP process died after PostgreSQL disconnect');
    assert.equal(child.signalCode, null);
  };
  const idle = await activity();
  assert.equal(idle.length, 1);
  await terminate(idle[0].pid);
  await delay(100); // Allow the unsolicited pool error to reach the child event loop.
  alive();
  const before = readCount();
  assert.notEqual((await call()).isError, true);
  assert.equal(readCount(), before + 1);
  const replacement = await activity();
  assert.equal(replacement.length, 1);
  assert.notEqual(replacement[0].pid, idle[0].pid);

  let pending;
  // Hold the lock on a dedicated client; activity polls need fresh autocommit snapshots.
  const lock = await db.connect();
  await lock.query('BEGIN');
  try {
    await lock.query('LOCK TABLE account_users IN ACCESS EXCLUSIVE MODE');
    pending = call();
    // Attach immediately so a child crash cannot create an unhandled rejection in the probe.
    pending.catch(() => {});
    let blocked = [];
    for (let i = 0; i < 100; i++) {
      blocked = await activity(true);
      if (blocked.length) break;
      alive();
      await delay(10);
    }
    assert.equal(blocked.length, 1, 'account query must be in flight before termination');
    await terminate(blocked[0].pid);
    const result = await pending;
    assert.equal(result.isError, true);
    const error = JSON.parse(result.content[0].text);
    assert.equal(error.error, 'account_binding_unavailable');
    assert.equal(error.retriable, true);
    assert.equal(error.tool, 'get_zones_geojson');
    assert.equal(typeof error.correlationId, 'string');
    assert.equal(readCount(), before + 1, 'failed authorization must have no business effect');
    alive();
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await pending?.catch(() => {});
  }
  assert.notEqual((await call()).isError, true);
  assert.equal(readCount(), before + 2);
  alive();
  writeFileSync('/evidence/disconnect-proof.json', JSON.stringify({
    idleBackend: idle[0].pid, replacementBackend: replacement[0].pid,
    idleSurvived: true, activeRetriable: true, noFailedEffect: true, sameSessionRecovered: true,
  }));
  console.log('PASS PostgreSQL disconnects: idle survival, active typed refusal, fresh backend, same-session recovery');
}
