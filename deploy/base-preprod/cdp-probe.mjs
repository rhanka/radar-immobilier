import { connectTarget, networkObserver } from './cdp-client.mjs';
import { resolvePath, readCheck, publicQualification } from './public-probe.mjs';

export async function runCdpQualification(config, cases, transport = {}) {
  const request = transport.fetch ?? fetch, WebSocketClass = transport.WebSocket ?? WebSocket;
  const base = new URL(transport.cdpBase ?? 'http://127.0.0.1:9222');
  const pause = transport.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('cdp_loopback_required');
  const network = networkObserver(config, cases);
  let targetId, client, result = { passed: false }, ownedTargetClosed = false;
  try {
    const created = await request(new URL('/json/new?about:blank', base), { method: 'PUT', signal: AbortSignal.timeout(5000) });
    if (!created.ok) throw new Error('dedicated_tab_creation_failed');
    const tab = await created.json();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(tab.id)) throw new Error('invalid_dedicated_target');
    targetId = tab.id;
    const socketUrl = new URL(tab.webSocketDebuggerUrl);
    if (socketUrl.protocol !== 'ws:' || socketUrl.hostname !== base.hostname || socketUrl.port !== base.port
      || socketUrl.pathname !== `/devtools/page/${targetId}`) throw new Error('invalid_dedicated_socket');
    client = await connectTarget(socketUrl, WebSocketClass, network.observe);
    await client.call('Network.enable'); await client.call('Page.enable');
    await client.call('Page.navigate', { url: config.origin + '/api/v1/auth/me' });
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const r = await client.call('Runtime.evaluate', { expression: `location.origin===${JSON.stringify(config.origin)}&&document.readyState==='complete'`, returnByValue: true });
      if (r.result?.value === true) { ready = true; break; }
      await pause(50);
    }
    if (!ready) throw new Error('public_origin_unavailable');
    const expression = `(async()=>{const resolvePath=${resolvePath.toString()};const readCheck=${readCheck.toString()};const publicQualification=${publicQualification.toString()};return publicQualification(${JSON.stringify(config)},${JSON.stringify(cases)});})()`;
    const evaluated = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 180000);
    if (evaluated.exceptionDetails || !evaluated.result?.value) throw new Error('probe_evaluation_failed');
    result = evaluated.result.value;
  } catch (error) {
    const allowed = ['dedicated_tab_creation_failed', 'invalid_dedicated_target', 'invalid_dedicated_socket',
      'public_origin_unavailable', 'probe_evaluation_failed', 'cdp_timeout', 'cdp_command_failed',
      'cdp_send_failed', 'cdp_connection_timeout', 'cdp_connection_failed'];
    result = { passed: false, error: allowed.includes(error.message) ? error.message : 'cdp_transport_failed' };
  } finally {
    client?.close();
    if (targetId) {
      try { ownedTargetClosed = (await request(new URL('/json/close/' + encodeURIComponent(targetId), base), { signal: AbortSignal.timeout(5000) })).ok; } catch { /* Échec explicite dans le reçu. */ }
    }
  }
  return { observedAt: new Date().toISOString(), phase: config.phase, ...result,
    passed: result.passed === true && ownedTargetClosed, networkFailures: network.failures,
    creation: 'PUT /json/new', ownedTargetClosed, cookiesExported: false, tokensExported: false };
}
