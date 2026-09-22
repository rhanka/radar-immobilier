#!/usr/bin/env node
// =============================================================================
// bascule.selftest.mjs — self-test des fonctions PURES de bascule.mjs.
//
// N'exécute AUCUN appel réel (0 kubectl, 0 aws, 0 DB, 0 réseau) : il n'importe
// que la fonction pure exportée `classifyJobStatus` et la nourrit de `.status`
// MOCKÉS. But : verrouiller la SEULE information que le runner lit d'un Job
// (verdict pass/fail/en-cours via .status) — le runner ne lit JAMAIS les logs.
//
//   node deploy/ci/bascule-preprod/bascule.selftest.mjs   → exit 0 si tout passe.
// =============================================================================
import process from "node:process";
import { classifyJobStatus } from "./bascule.mjs";

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

// 1) succeeded>=1 → done + ok.
eq("succeeded=1 ⇒ done/ok/succeeded", classifyJobStatus({ succeeded: 1 }), { done: true, ok: true, state: "succeeded" });

// 2) failed>=1 → done + !ok (fail-closed).
eq("failed=1 ⇒ done/!ok/failed", classifyJobStatus({ failed: 1 }), { done: true, ok: false, state: "failed" });

// 3) active>0 sans succeeded/failed → en cours (active).
eq("active=1 ⇒ !done/active", classifyJobStatus({ active: 1 }), { done: false, ok: false, state: "active" });

// 4) status vide ({}) → en attente (pending), ni done ni ok.
eq("{} ⇒ !done/pending", classifyJobStatus({}), { done: false, ok: false, state: "pending" });

// 5) undefined/null → pending (robustesse : status pas encore peuplé).
eq("undefined ⇒ pending", classifyJobStatus(undefined), { done: false, ok: false, state: "pending" });
eq("null ⇒ pending", classifyJobStatus(null), { done: false, ok: false, state: "pending" });

// 6) succeeded prime sur active (pod terminé OK alors qu'un autre index actif).
eq("succeeded=1 & active=1 ⇒ succeeded", classifyJobStatus({ succeeded: 1, active: 1 }), { done: true, ok: true, state: "succeeded" });

// 7) failed prime sur active (fail-closed : un pod en échec = KO).
eq("failed=1 & active=1 ⇒ failed", classifyJobStatus({ failed: 1, active: 1 }), { done: true, ok: false, state: "failed" });

// 8) champs string (jsonpath peut renvoyer des strings) → coercés en nombre.
eq("succeeded='1' (string) ⇒ succeeded", classifyJobStatus({ succeeded: "1" }), { done: true, ok: true, state: "succeeded" });
eq("failed='2' (string) ⇒ failed", classifyJobStatus({ failed: "2" }), { done: true, ok: false, state: "failed" });

console.log(`\nbascule.selftest — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
