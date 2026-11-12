#!/usr/bin/env node
// make classif-seat-auth-refresh SEAT=<seat> ENV=preprod — atomically replaces the auth of one
// isolated codex seat home (~/.local/share/radar-classif-seats/<seat>/auth.json) with
// ~/.codex/auth.json. Use it after a new codex login of the owner, or when a run stops on
// authentication errors of that seat (the stop message names this command), then resume the
// stopped run with the same command. No model call; prints the seat home path only.
import process from 'node:process';
import { refreshCodexAuth } from './run-seat.mjs';

const argv = process.argv.slice(2);
const seat = argv.includes('--seat') ? argv[argv.indexOf('--seat') + 1] : process.env.SEAT;
if (!seat) { process.stderr.write('classif-seat-auth-refresh: pass SEAT=<seat> (astra-max, astra-low, astra-medium, sol-6.1-low, sol-6.1-medium, luna-6-low)\n'); process.exit(2); }
try {
  process.stdout.write(`classif-seat-auth-refresh: ${seat} auth refreshed in ${refreshCodexAuth(seat)}\n`);
} catch (e) {
  process.stderr.write(`classif-seat-auth-refresh: ${e.message}\n`);
  process.exit(1);
}
