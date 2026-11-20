// Account-refusal guard (owner 12/11, after the Google account disablement during series 9):
// the FIRST failed call whose provider or CLI error reads as an account refusal (HTTP 401/403,
// permission denied, service disabled, terms of service, suspended, no access to the model)
// stops every further launch of the run, whatever the seat; the run then stops with the exact
// resume command BEFORE any aggregate or blind/S113 audit is written (the one-shot blind run is
// never consumed by a refused account). Read from stderr and the CLI error envelope only, never
// from the model's answer. Codex transport notices (WebSocket 403 then HTTPS fallback, benign on
// an answered call) are ignored.

const REFUSAL = /\b40[13]\b|permission[_ ]denied|unauthori[sz]ed|(?:service|account) (?:has been )?disabled|disabled in this account|terms of service|violation|suspended|banned|lack access|does not exist or you lack access/i;
const TRANSPORT_NOTICE = /^(?:Reconnecting\.\.\. \d+\/\d+ \(|Falling back from WebSockets to HTTPS transport\.)/;

/** A failed call whose stderr or CLI error envelope reads as an account refusal. */
export function looksLikeAccountRefusal(r) {
  if (!r || r.code === 0) return false;
  const lines = `${r.stderrTail ?? ''}\n${r.errorEnvelope ?? ''}`.split('\n').filter((l) => l.trim() && !TRANSPORT_NOTICE.test(l.trim()));
  return lines.some((l) => REFUSAL.test(l));
}

export class AccountRefusal extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'AccountRefusal';
    Object.assign(this, details);
  }
}

/** One guard per run: observe(route, r) after each call, blocks() before each launch, error(cmd) to stop. */
export function createAccountGuard() {
  let tripped = null;
  return {
    get tripped() { return tripped; },
    blocks: () => Boolean(tripped),
    observe(route, r) {
      if (!tripped && looksLikeAccountRefusal(r)) tripped = { route, at: new Date().toISOString(), code: r.code };
      return tripped;
    },
    error(resumeCommand) {
      return new AccountRefusal(`account refusal guard: ${tripped.route} answered an account refusal (exit ${tripped.code}: 401/403, disabled, terms or no access) at ${tripped.at}; no further call launched on any seat, run stopped before any aggregate or audit (answered calls are cached). Check the account with its owner before resuming with \`${resumeCommand}\`.`, { ...tripped });
    },
  };
}
