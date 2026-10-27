/**
 * PW-C application surface factory: exact-route wiring for the four app
 * routes (summary HTML, management/result, confirm, revoke).
 *
 * The operator injects the database, identity domain, account reader and
 * challenge keys; PW-C supplies rendering (summary/management/login) and
 * command dispatch (PW-B confirm, PW-D revoke). A null return is never
 * produced here: when the domain is unresolvable the caller keeps PW closed.
 */
import type { Database } from "../db/client.js";
import type { PwIntentRow } from "../services/facets/pw-write-store.js";
import type { PwConfirmation } from "../services/facets/pw-write-confirmation.js";
import type { AppGuardDeps, AppGuardPass } from "./write-intent-app-guard.js";
import type { WriteAppDeps } from "./write-intent-app-authority.js";
import { confirmWriteIntent, revokeWriteIntent } from "./write-intent-app-dispatch.js";
import { renderWriteIntentLogin, renderWriteIntentManagement, renderWriteIntentSummary } from "./write-intent-app-page.js";

export interface AppSurfaceConfig extends AppGuardDeps {
  db: Database;
  challengeKeys: ReadonlyMap<string, Uint8Array>;
}

/** Build the live WriteAppDeps: PW stays closed when the caller passes none. */
export function createWriteAppSurface(config: AppSurfaceConfig): WriteAppDeps {
  return {
    auth: config.auth,
    domain: config.domain,
    accounts: config.accounts,
    nowMs: config.nowMs,
    sessionSecret: config.sessionSecret,
    db: config.db,
    challengeKeys: config.challengeKeys,
    renderSummary: (c, row, bootstrap) => renderWriteIntentSummary(c, row, bootstrap),
    renderManagement: (c, row, bootstrap) => renderWriteIntentManagement(c, row, bootstrap),
    renderLogin: () => renderWriteIntentLogin(),
    confirm: (row: PwIntentRow, proof: PwConfirmation) => confirmWriteIntent(config.db, row, proof),
    revoke: (row: PwIntentRow, principal: AppGuardPass["principal"]) =>
      revokeWriteIntent(config.db, row, principal),
  };
}
