// @sentropic/engram 0.21.2 (pinned in api/package.json, unchanged) run through its existing CLI /
// skill runtime inside a throw-away node:24 container: deps volume read-only, workspace mounted at
// /work, no network, current uid/gid (no root-owned files).
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { REPO } from './paths.mjs';
import { DEPS_VOLUME, IMAGE } from './bprime.mjs';

export const PROFILE_DIR = path.join(REPO, 'radar', 'ontology', 'steve-classification');
export const ENGRAM_VERSION = '0.21.2';

function docker(work, entry, args, { input } = {}) {
  const uid = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : '1000:1000';
  const run = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--user', uid, '-e', 'HOME=/tmp', '-e', 'ENGRAM_QUIET_DEPRECATION=1',
    '-v', `${DEPS_VOLUME}:/w:ro`, '-v', `${work}:/work`, '-w', '/work', IMAGE, 'node', `/w/node_modules/@sentropic/engram/dist/${entry}`, ...args],
  { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

export const engram = (work, args, opts) => docker(work, 'cli.js', args, opts);
export const skillRuntime = (work, args, opts) => docker(work, 'skill-runtime.js', args, opts);

export function engramVersion(work) {
  const r = engram(work, ['--version']);
  return r.stdout.trim();
}

/** Copies the repository profile into a private workspace (corpus written by the caller). */
export function prepareWorkspace(work) {
  mkdirSync(work, { recursive: true, mode: 0o700 });
  cpSync(PROFILE_DIR, work, { recursive: true });
  mkdirSync(path.join(work, 'corpus'), { recursive: true });
  return work;
}

/** validate → dataprep → profile-prompt; returns paths and hashes. Throws on any failure. */
export function buildProfileState(work) {
  for (const [label, r] of [
    ['profile validate', engram(work, ['profile', 'validate', '--config', 'engram.yaml'])],
    ['profile dataprep', engram(work, ['profile', 'dataprep', '.', '--config', 'engram.yaml'])],
  ]) {
    if (r.status !== 0) throw new Error(`engram ${label} failed: ${(r.stderr || r.stdout).slice(-800)}`);
  }
  const state = '.graphify/profile/profile-state.json';
  const p = skillRuntime(work, ['profile-prompt', '--profile-state', state, '--out', 'profile-prompt.md']);
  if (p.status !== 0) throw new Error(`engram profile-prompt failed: ${(p.stderr || p.stdout).slice(-800)}`);
  return { state: path.join(work, state), prompt: readFileSync(path.join(work, 'profile-prompt.md'), 'utf8') };
}

/** Validates one extraction file (path relative to the workspace). Returns Engram's JSON result. */
export function validateExtraction(work, relInput) {
  const r = engram(work, ['profile', 'validate-extraction', '--profile-state', '.graphify/profile/profile-state.json', '--input', relInput, '--json']);
  try { return JSON.parse(r.stdout); } catch { return { valid: false, issues: [{ severity: 'error', code: 'engram_failed', message: (r.stderr || r.stdout).slice(-400) }] }; }
}
