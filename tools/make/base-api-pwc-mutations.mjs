import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const app = "src/artifacts/write-intent-app-invariants-db.test.ts";
const page = "src/artifacts/write-intent-page-regressions.test.ts";
const browser = "src/artifacts/write-intent-app-script.test.ts";
const mutations = [
  ["M14-forwarded-headers", "artifacts/write-intent-page-listener.ts", "for (const [name, value] of Object.entries(READER_CONTENT_HEADERS)) headers.set(name, value);",
    "", "src/artifacts/write-intent-page-listener.test.ts", "private headers on forwarded HTTP"],
  ["M16-management-state", "artifacts/write-intent-app-route.ts", "pwIntentStatus(row, (deps.nowMs ?? Date.now)())", '"pending"',
    "src/artifacts/write-intent-app-surface-db.test.ts", "confirm through the summary"],
  ["C02-revoke-upgrade", "artifacts/write-intent-app-dispatch.ts", "const live = await loadPwIntentForUpdate(tx, row.intentId);",
    "const live = await loadPwIntentForShare(tx, row.intentId);", app, "simultaneous owner revocations"],
  ["M02-issuer", "services/facets/pw-write-confirmation.ts", "owner.issuer !== principal.issuer || ", "", app, "different identity domain"],
  ["M02-tier", "services/facets/pw-write-confirmation.ts", "\n    || owner.tier !== principal.tier", "", app, "different identity domain"],
  ["M03-origin", "artifacts/write-intent-app-guard.ts", 'if (c.req.header("origin") !== appOrigin)', "if (false)", app, "independent origin and CSRF guards"],
  ["M03-csrf", "artifacts/write-intent-app-authority.ts", "if (!verifyWriteIntentCsrf({", "if (false && !verifyWriteIntentCsrf({", app, "independent origin and CSRF guards"],
  ["M03-cookie-binding", "artifacts/write-intent-csrf.ts", "[principal.issuer, principal.sub, principal.tier], cookieHash,",
    '[principal.issuer, principal.sub, principal.tier], "unbound",',
    "src/artifacts/write-intent-app-rights-db.test.ts", "cookie remint"],
  ["M03-intent-binding", "artifacts/write-intent-csrf.ts", "intentId.toLowerCase(), expiresAtSec", '"unbound", expiresAtSec', app, "independent origin and CSRF guards"],
  ["M05-auto-confirm", "artifacts/write-intent-app-script.ts", 'var confirmBtn = $("pw-confirm");',
    'post(boot.confirmUrl, { challengeToken: boot.challengeToken });\n  var confirmBtn = $("pw-confirm");', browser, "send nothing until an explicit"],
  ["M05-new-session", "artifacts/write-intent-app-route.ts", "return deps.renderSummary(c, row, challengeBootstrap(row, deps, pass));",
    'c.header("Set-Cookie", "radar_session=synthetic; Secure; HttpOnly");\n      return deps.renderSummary(c, row, challengeBootstrap(row, deps, pass));', app, "independent origin and CSRF guards"],
  ["M05-new-login", "artifacts/write-intent-app-script.ts", 'export const APP_LOGIN_PATH = "/api/v1/auth/login";',
    'export const APP_LOGIN_PATH = "/api/v1/artifact-write/login";', "src/artifacts/write-intent-app-page.test.ts", "fixed login link"],
  ["M05-secret-to-page", "artifacts/write-intent-h5-route.ts", "data }, created ? 201 : 200)",
    'data: { ...data, challengeToken: "synthetic-private-challenge" } }, created ? 201 : 200)',
    "tests/integration/pw-write-authority.spec.ts", "prepare idempotently"],
  ["M12-retry-key", "artifacts/write-intent-page.ts", "prepare(attempt.gesture, attempt.key);", "prepare(attempt.gesture, crypto.randomUUID());",
    "src/artifacts/write-intent-page.test.ts", "replay the exact key"],
  ["M12-uncertain-new-key", "artifacts/write-intent-page.ts", "if (preparing || pendingAttempt) return;", "if (preparing) return;", page, "keep uncertain preparation"],
  ["M14-coop", "artifacts/write-intent-app-route.ts", 'c.header("Cross-Origin-Opener-Policy", "same-origin");', "", app, "independent origin and CSRF guards"],
  ["M14-opener", "artifacts/write-intent-page.ts", 'window.open(url, "_blank", "noopener,noreferrer")', 'window.open(url, "_blank", "")',
    "src/artifacts/write-intent-page.test.ts", "prepare every gesture"],
  ["M15-reset", "artifacts/write-intent-page.ts", "if (poll.intentId === intentId) return;", "", page, "fixed budget"],
  ["M15-window", "artifacts/write-intent-page.ts", "(now - poll.startedAt) >= WINDOW_MS", "false", page, "fixed budget"],
  ["M15-manual-loop", "artifacts/write-intent-page.ts", "if (!manual) schedule(wait * 1000);",
    "poll.stopped = false; poll.startedAt = Date.now(); schedule(wait * 1000);", page, "never resume automatic"],
  ["M15-single-flight", "artifacts/write-intent-page.ts", "if (poll.intentId === null || poll.inFlight) return;", "if (poll.intentId === null) return;", page, "one in-flight status"],
  ["M15-count", "artifacts/write-intent-page.ts", "poll.count >= MAX_POLLS", "false", "src/artifacts/write-intent-page-poll.test.ts", "after sixty polls"],
  ["M16-old-result", "artifacts/write-intent-page.ts", "if (intentId !== poll.intentId) return;\n      handleStatus(out);", "handleStatus(out);", page, "late result"],
  ["M16-page-http", "artifacts/write-intent-page.ts", "if (out.status === 200 && state && TERMINAL[state])", "if (state && TERMINAL[state])", page, "never accept HTTP"],
  ["M16-app-http", "artifacts/write-intent-app-script.ts", 'out.status === 200 && out.data && out.data.state === "committed"',
    'out.data && out.data.state === "committed"', browser, "never project HTTP"],
];

const receipts = [];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(name, scope, title) {
  const output = `/evidence/${name}.json`;
  const result = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
    scope, "-t", title, "--reporter=json", `--outputFile.json=${output}`],
  { encoding: "utf8", timeout: 180_000 });
  writeFileSync(`/evidence/${name}.log`, (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.error || result.signal) throw result.error ?? new Error(`Signal: ${name}`);
  const report = JSON.parse(readFileSync(output, "utf8"));
  const selected = report.testResults.flatMap((suite) => suite.assertionResults)
    .filter((test) => test.fullName.includes(title));
  if (!selected.length) throw new Error(`Missing selected assertion: ${name}`);
  return { result, selected };
}
for (const [name, file, before, after, scope, title] of mutations) {
  const path = `src/${file}`;
  const original = readFileSync(path, "utf8");
  if (original.split(before).length !== 2) throw new Error(`Nonunique anchor: ${name}`);
  try {
    writeFileSync(path, original.replace(before, after));
    const mutant = run(name, scope, title);
    if (mutant.result.status === 0 || !mutant.selected.some((test) => test.status === "failed"
      && test.failureMessages.some((message) => /AssertionError/.test(message)))) {
      throw new Error(`No targeted functional failure: ${name}`);
    }
  } finally {
    writeFileSync(path, original);
  }
  const restored = run(`${name}-restored`, scope, title);
  if (restored.result.status !== 0 || restored.selected.some((test) => test.status !== "passed")
    || sha(readFileSync(path)) !== sha(original)) throw new Error(`Restoration failed: ${name}`);
  receipts.push({ name, scope, title, killed: true, restored: true, sha256: sha(original) });
  writeFileSync("/evidence/mutations.json", JSON.stringify(receipts, null, 2));
  console.log(`KILLED and RESTORED ${name}`);
}
