import vm from 'node:vm';
import { fixtureFetch } from './base-preprod-probe-fixture.mjs';
export function cdpFixture(config, cases, failure = '') {
  const trace = [], business = fixtureFetch(config, cases);
  let socket;
  const emit = message => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  const context = vm.createContext({ location: { origin: 'null' }, document: { readyState: 'complete' }, AbortSignal,
    fetch: async (path, options) => {
      if (failure === 'network' && path.includes('projection-revisions')) {
        emit({ method: 'Network.requestWillBeSent', params: { requestId: 'owned-request', request: {
          url: config.origin + path, headers: { Cookie: 'sensitive-fixture-only' } } } });
        emit({ method: 'Network.loadingFailed', params: { requestId: 'owned-request', errorText: 'net::ERR_FAILED',
          blockedReason: 'origin', corsErrorStatus: { corsError: 'MissingAllowOriginHeader' } } });
        throw new TypeError('sensitive-fixture-only');
      }
      return business(path, options);
    } });
  class Socket extends EventTarget {
    constructor() { super(); socket = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(data) {
      const { id, method, params } = JSON.parse(data);
      trace.push({ method });
      Promise.resolve().then(async () => {
        if (failure === 'command' && method === 'Page.navigate') throw new Error();
        let result = {};
        if (method === 'Page.navigate') context.location.origin = new URL(params.url).origin;
        if (method === 'Runtime.evaluate') result = { result: { value: await vm.runInContext(params.expression, context) } };
        emit({ id, result });
      }).catch(() => emit({ id, error: { message: 'sensitive-fixture-only' } }));
    }
    close() { trace.push({ method: 'socket.close' }); }
  }
  return { trace, WebSocket: Socket, pause: async () => {}, fetch: async (url, options = {}) => {
    const path = new URL(url).pathname;
    trace.push({ method: options.method ?? 'GET', path });
    if (path === '/json/new' && options.method === 'PUT') return Response.json({
      id: 'owned-fixture', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/owned-fixture' });
    if (path === '/json/close/owned-fixture') return new Response('closed');
    throw new Error('Cible CDP non autorisée dans la fixture');
  } };
}
