#!/usr/bin/env node
/**
 * Hyperliquid Listing Hunter GitHub Actions runner.
 * Starts the long-running worker for a bounded window, then exits cleanly so
 * the workflow can persist state back to the repository.
 */
import { spawn } from 'node:child_process';

const RUN_MS = Math.max(60_000, Number(process.env.LISTING_RUN_MS || 210_000));
const child = spawn(process.execPath, ['hyperliquid_listing_hunter.mjs'], {
  stdio: 'inherit',
  env: process.env,
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000).unref();
};

const timer = setTimeout(stop, RUN_MS);
timer.unref();

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (stopping) process.exit(0);
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
child.on('error', () => process.exit(1));
process.on('SIGINT', () => { stop(); });
process.on('SIGTERM', () => { stop(); });
