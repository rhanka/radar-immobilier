/* global Event, EventTarget, MessageEvent, queueMicrotask */
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectTarget } from '../../deploy/base-preprod/cdp-client.mjs';
test('masque le message distant des erreurs CDP et ferme son socket', async () => {
  let closed = false;
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(data) { const { id } = JSON.parse(data); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message',
      { data: JSON.stringify({ id, error: { message: 'sensitive' } }) }))); }
    close() { closed = true; }
  }
  const client = await connectTarget('ws://127.0.0.1:9222/devtools/page/fixture', Socket);
  await assert.rejects(client.call('Runtime.evaluate'), { message: 'cdp_command_failed' });
  client.close();
  assert.equal(closed, true);
});

test('interrompt immédiatement une commande si le socket CDP se ferme', async () => {
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send() { queueMicrotask(() => this.dispatchEvent(new Event('close'))); }
    close() {}
  }
  const client = await connectTarget('ws://127.0.0.1:9222/devtools/page/fixture', Socket);
  try { await assert.rejects(client.call('Runtime.evaluate', {}, 30), { message: 'cdp_connection_closed' }); }
  finally { client.close(); }
});
