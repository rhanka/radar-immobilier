import test from 'node:test';
import assert from 'node:assert/strict';
import { connectTarget, networkObserver } from '../../deploy/base-preprod/cdp-client.mjs';
test('ne conserve aucun en-tête ni paramètre sensible dans le diagnostic réseau CDP', () => {
  const observer = networkObserver({ origin: 'https://preprod.immo.sent-tech.ca', workspaceId: 'fixture', citySlug: 'fixture' },
    [{ path: '/api/v1/workspaces/:workspaceId/signal-facets/projection-revisions' }]);
  observer.observe('Network.requestWillBeSent', { requestId: 'owned', request: {
    url: 'https://preprod.immo.sent-tech.ca/api/v1/workspaces/fixture/signal-facets/projection-revisions?private=sensitive',
    headers: { Cookie: 'sensitive' } } });
  observer.observe('Network.loadingFailed', { requestId: 'owned', errorText: 'net::ERR_FAILED',
    blockedReason: 'origin', corsErrorStatus: { corsError: 'MissingAllowOriginHeader' } });
  assert.equal(observer.failures[0].corsError, 'MissingAllowOriginHeader');
  assert.equal(JSON.stringify(observer.failures).includes('sensitive'), false);
});
test('masque le message distant des erreurs CDP et ferme son socket', async () => {
  let closed = false;
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(data) { const { id } = JSON.parse(data); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message',
      { data: JSON.stringify({ id, error: { message: 'sensitive' } }) }))); }
    close() { closed = true; }
  }
  const client = await connectTarget('ws://127.0.0.1:9222/devtools/page/fixture', Socket, () => {});
  await assert.rejects(client.call('Page.enable'), { message: 'cdp_command_failed' });
  client.close();
  assert.equal(closed, true);
});
