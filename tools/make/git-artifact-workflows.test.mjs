// G0 v3 §5 P7 / §7.1 condition 5: workflow guards (no artifact build in CI).
// Job `if:` expressions are evaluated for a given ref with EVERY other term
// (vars, inputs, needs, status functions) enumerated true and false, so a
// guard holds whatever the repository variables or inputs are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import YAML from 'yaml';

// GitHub filter glob: `**` crosses `/`, `*` stays within a segment.
const globToRegExp = glob => new RegExp(`^${glob.split('**').map(part => part
  .replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('.*')}$`);

const DIR = '.github/workflows';
const workflows = Object.fromEntries(readdirSync(DIR).filter(f => /\.ya?ml$/.test(f))
  .map(f => [f, YAML.parse(readFileSync(`${DIR}/${f}`, 'utf8'))]));
const ARTIFACT_BRANCH = 'artifact/p/0123abcd/demo-0123abcd';
const SCENARIOS = {
  artifactDispatch: { ref: `refs/heads/${ARTIFACT_BRANCH}`, head_ref: '' },
  artifactPr: { ref: 'refs/pull/1/merge', head_ref: ARTIFACT_BRANCH },
  featurePr: { ref: 'refs/pull/2/merge', head_ref: 'feat/x' },
  main: { ref: 'refs/heads/main', head_ref: '' },
  tag: { ref: 'refs/tags/v1.2.3', head_ref: '' },
  otherBranch: { ref: 'refs/heads/feat/x', head_ref: '' },
};

// ── Minimal GitHub expression evaluator (ref terms concrete, rest symbolic)
function tokenize(src) {
  const tokens = [];
  const re = /\s*(\$\{\{|\}\}|&&|\|\||==|!=|!|\(|\)|,|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.\-*]*|[0-9]+)/y;
  const end = src.trimEnd().length;
  let pos = 0;
  while (pos < end) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`untokenizable at ${pos}: ${src}`);
    pos = re.lastIndex;
    if (m[1] !== '${{' && m[1] !== '}}') tokens.push(m[1]);
  }
  return tokens;
}
function parse(src) {
  const t = tokenize(String(src));
  let i = 0;
  const peek = () => t[i];
  const next = () => t[i++];
  const primary = () => {
    const tok = next();
    if (tok === '(') { const e = or(); assert.equal(next(), ')'); return e; }
    if (tok === '!') return { op: '!', a: primary() };
    if (tok.startsWith("'")) return { lit: tok.slice(1, -1).replace(/''/g, "'") };
    if (peek() === '(') {
      next();
      const args = [];
      while (peek() !== ')') { args.push(or()); if (peek() === ',') next(); }
      next();
      return { call: tok, args };
    }
    return { id: tok };
  };
  const cmp = () => {
    let a = primary();
    while (peek() === '==' || peek() === '!=') { const op = next(); a = { op, a, b: primary() }; }
    return a;
  };
  const and = () => { let a = cmp(); while (peek() === '&&') { next(); a = { op: '&&', a, b: cmp() }; } return a; };
  const or = () => { let a = and(); while (peek() === '||') { next(); a = { op: '||', a, b: and() }; } return a; };
  const e = or();
  assert.equal(i, t.length, `trailing tokens in ${src}`);
  return e;
}
const text = n => JSON.stringify(n);
const CONCRETE = new Set(['github.ref', 'github.head_ref', 'github.ref_type']);
function value(n, ctx, atoms) {
  if ('lit' in n) return n.lit;
  if (n.id && CONCRETE.has(n.id)) return n.id === 'github.ref_type' ? (ctx.ref.startsWith('refs/tags/') ? 'tag' : 'branch') : ctx[n.id.slice(7)];
  return bool(n, ctx, atoms);
}
const concrete = n => ('lit' in n) || (n.id && CONCRETE.has(n.id));
function bool(n, ctx, atoms) {
  if (n.op === '!') return !bool(n.a, ctx, atoms);
  if (n.op === '&&') return bool(n.a, ctx, atoms) && bool(n.b, ctx, atoms);
  if (n.op === '||') return bool(n.a, ctx, atoms) || bool(n.b, ctx, atoms);
  if ((n.op === '==' || n.op === '!=') && concrete(n.a) && concrete(n.b)) {
    return (value(n.a, ctx, atoms) === value(n.b, ctx, atoms)) === (n.op === '==');
  }
  if (n.call === 'startsWith' && concrete(n.args[0]) && concrete(n.args[1])) {
    return String(value(n.args[0], ctx, atoms)).startsWith(value(n.args[1], ctx, atoms));
  }
  if ('lit' in n) return n.lit !== '';
  if (n.id && CONCRETE.has(n.id)) return value(n, ctx, atoms) !== '';
  return atoms.get(text(n));
}
function collectAtoms(n, out = new Set()) {
  if (n.op === '!') collectAtoms(n.a, out);
  else if (n.op === '&&' || n.op === '||') { collectAtoms(n.a, out); collectAtoms(n.b, out); }
  else if ((n.op === '==' || n.op === '!=') && concrete(n.a) && concrete(n.b)) { /* concrete */ }
  else if (n.call === 'startsWith' && concrete(n.args[0]) && concrete(n.args[1])) { /* concrete */ }
  else if (!('lit' in n) && !(n.id && CONCRETE.has(n.id))) out.add(text(n));
  return out;
}
/** Every outcome of `expr` for a ref scenario, over all symbolic assignments. */
function outcomes(expr, scenario, fixed = {}) {
  if (expr === undefined) return new Set([true]);
  const ast = parse(expr);
  const atoms = [...collectAtoms(ast)].filter(a => !(a in fixed));
  const results = new Set();
  for (let mask = 0; mask < 2 ** atoms.length; mask += 1) {
    const map = new Map(Object.entries(fixed));
    atoms.forEach((a, k) => map.set(a, Boolean(mask & (1 << k))));
    results.add(bool(ast, SCENARIOS[scenario], map));
  }
  return results;
}
const never = (expr, scenario, fixed) => !outcomes(expr, scenario, fixed).has(true);
const can = (expr, scenario, fixed) => outcomes(expr, scenario, fixed).has(true);

test('the guard evaluator itself distinguishes refs', () => {
  const guard = "github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')";
  assert.ok(never(guard, 'artifactDispatch') && never(guard, 'otherBranch'));
  assert.ok(can(guard, 'main') && can(guard, 'tag'));
  assert.ok(can("vars.X == 'true' && inputs.Y", 'artifactDispatch'), 'symbolic terms do not block');
  assert.ok(never("${{ !startsWith(github.head_ref, 'artifact/') }}", 'artifactPr'));
});

// ── P7: ordinary CI on push / pull_request
const triggers = w => (typeof w.on === 'string' ? { [w.on]: null } : Array.isArray(w.on) ? Object.fromEntries(w.on.map(k => [k, null])) : w.on);

test('no workflow uses pull_request_target or workflow_run', () => {
  for (const [f, w] of Object.entries(workflows)) {
    assert.equal('pull_request_target' in triggers(w), false, f);
    assert.equal('workflow_run' in triggers(w), false, f);
  }
});

test('push triggers never match an artifact branch', () => {
  for (const [f, w] of Object.entries(workflows)) {
    const push = triggers(w).push;
    if (push === undefined) continue;
    assert.ok(push && (push.branches || push.tags), `${f}: push without a branch/tag filter`);
    assert.equal('branches-ignore' in push, false, `${f}: branches-ignore admits artifact pushes`);
    for (const pattern of push.branches ?? []) assert.equal(globToRegExp(pattern).test(ARTIFACT_BRANCH), false, `${f}: ${pattern}`);
  }
});

test('pull_request workflows ignore artifact targets and refuse artifact heads', () => {
  const prWorkflows = Object.entries(workflows).filter(([, w]) => 'pull_request' in triggers(w));
  assert.deepEqual(prWorkflows.map(([f]) => f).sort(), ['branch-policy.yml', 'ci.yml']);
  for (const [f, w] of prWorkflows) {
    assert.ok(triggers(w).pull_request['branches-ignore'].includes('artifact/**'), `${f}: target filter`);
  }
  const ci = workflows['ci.yml'];
  for (const [name, job] of Object.entries(ci.jobs)) {
    assert.ok(never(job.if, 'artifactPr'), `ci.yml/${name} runs for an artifact PR head`);
    assert.ok(can(job.if, 'featurePr') && can(job.if, 'main'), `ci.yml/${name} still runs for ordinary refs`);
  }
});

test('the required branch-policy check fails an artifact PR without running its code', () => {
  const job = workflows['branch-policy.yml'].jobs.enforce;
  assert.equal(job.name, 'Enforce repo policy');
  assert.equal(workflows['branch-policy.yml'].permissions.contents, 'read');
  const [refuse, ...rest] = job.steps;
  assert.ok(can(refuse.if, 'artifactPr') && never(refuse.if, 'featurePr'));
  assert.equal(refuse.uses, undefined);
  assert.match(refuse.run, /exit 1/);
  assert.equal(JSON.stringify(refuse).includes('secrets.'), false);
  const checkout = rest.find(s => String(s.uses).startsWith('actions/checkout'));
  assert.ok(never(checkout.if, 'artifactPr') && can(checkout.if, 'featurePr'));
});

// ── P7: protected environments refuse anything but main and version tags
const PROTECTED_ENVS = new Set(['production', 'preprod', 'prod', 'radar-bascule', 'radar-backup-prod', 'radar-e2e', 'github-pages']);
const touchesProtected = job => {
  const env = typeof job.environment === 'object' ? job.environment?.name : job.environment;
  const s = JSON.stringify(job);
  return PROTECTED_ENVS.has(env) || /secrets\.KUBE_CONFIG_DATA/.test(s) || /lock-action/.test(s);
};
// Jobs whose `if:` carries a gate this branch must not edit; they deploy only
// through a GitHub environment whose server-side policy is `main` (verified
// with `gh api .../environments/radar-bascule/deployment-branch-policies`).
const ENVIRONMENT_POLICY_ONLY = { 'bascule-preprod.yml': { bascule: 'radar-bascule', recover: 'radar-bascule' } };

test('every protected-environment job refuses an artifact dispatch ref', () => {
  const checked = [];
  for (const [f, w] of Object.entries(workflows)) {
    for (const [name, job] of Object.entries(w.jobs)) {
      if (!touchesProtected(job)) continue;
      checked.push(`${f}/${name}`);
      const envOnly = ENVIRONMENT_POLICY_ONLY[f]?.[name];
      if (envOnly) { assert.equal(job.environment, envOnly, `${f}/${name}`); continue; }
      for (const scenario of ['artifactDispatch', 'otherBranch']) {
        assert.ok(never(job.if, scenario), `${f}/${name} can run on ${scenario}`);
      }
      assert.ok(can(job.if, 'main') || can(job.if, 'tag'), `${f}/${name} is blocked everywhere`);
    }
  }
  for (const j of ['run-job.yaml/run', 'k8s-apply-mcp.yaml/apply', 'rollback.yml/rollback-preprod', 'rollback.yml/rollback-prod',
    'bascule-bundle-cd.yml/apply-bundle', 'bascule-bundle-cd.yml/apply-backup', 'bascule-refresh.yml/force-refresh',
    'build-push-images.yml/deploy', 'build-push-images.yml/deploy-preprod', 'build-push-images.yml/prepare-preprod-db',
    'build-push-images.yml/promote-prod', 'bascule-e2e.yml/e2e', 'deploy-gh-pages.yml/deploy',
    'bascule-preprod.yml/bascule', 'bascule-preprod.yml/recover']) {
    assert.ok(checked.includes(j), `${j} not recognized as protected`);
  }
});

test('an artifact dispatch ref never builds or pushes images', () => {
  const job = workflows['build-push-images.yml'].jobs['build-push'];
  assert.ok(never(job.if, 'artifactDispatch'));
  assert.ok(can(job.if, 'main') && can(job.if, 'otherBranch'));
});

// ── Review E2: a version tag deploys only when its commit is on main history
const ANCESTRY = 'bash deploy/ci/require-main-ancestry.sh';
const usesSecretOrMutation = step => /secrets\./.test(JSON.stringify(step)) || step.uses === './deploy/cutover/lock-action';

test('every job a version tag can start proves main ancestry before any secret or mutation', () => {
  const checked = [];
  for (const [f, w] of Object.entries(workflows)) {
    for (const [name, job] of Object.entries(w.jobs)) {
      if (!touchesProtected(job) || ENVIRONMENT_POLICY_ONLY[f]?.[name] || !can(job.if, 'tag')) continue;
      checked.push(`${f}/${name}`);
      const steps = job.steps;
      const checkout = steps.findIndex(s => String(s.uses).startsWith('actions/checkout'));
      const first = steps.findIndex(usesSecretOrMutation);
      const ancestry = steps.findIndex(s => s.run === ANCESTRY || String(s.run).includes("git merge-base --is-ancestor \"$GITHUB_SHA\" origin/main"));
      assert.ok(ancestry > checkout && checkout >= 0, `${f}/${name}: ancestry check after checkout`);
      assert.ok(first === -1 || ancestry < first, `${f}/${name}: ancestry check precedes the first secret or lock`);
      if (steps[ancestry].run === ANCESTRY) {
        assert.ok(can(steps[ancestry].if, 'tag') && never(steps[ancestry].if, 'main'), `${f}/${name}: runs for tags`);
      }
    }
  }
  assert.deepEqual(checked.sort(), ['bascule-bundle-cd.yml/apply-backup', 'bascule-bundle-cd.yml/apply-bundle',
    'bascule-refresh.yml/force-refresh', 'build-push-images.yml/promote-prod', 'k8s-apply-mcp.yaml/apply',
    'rollback.yml/rollback-preprod', 'rollback.yml/rollback-prod', 'run-job.yaml/run']);
});

test('no workflow builds or publishes a git-backed artifact', () => {
  for (const [f, w] of Object.entries(workflows)) {
    const raw = JSON.stringify(w);
    assert.equal(/build:artifact|publish-dist|ARTIFACT_CG6/.test(raw), false, f);
  }
  assert.equal(Object.keys(workflows).includes('artifact-cg6-publish.yml'), false);
});
