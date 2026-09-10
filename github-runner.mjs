// Smart Money Futures AI Bot — GitHub Actions adapter
// V17.5.2-GITHUB-ACTIONS-BIGINT-SAFE-MARKET-RESOLVER
// Imports the canonical root worker_core.mjs and fails fast on stale deployments.
import fs from "node:fs/promises";
import path from "node:path";
import worker, { BOT_VERSION, BOT_BUILD } from "./worker_core.mjs";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, "state");
const EXPECTED_WORKER_VERSION = "V17.5.2-GMX-BIGINT-SAFE-MARKET-RESOLVER";

async function ensureStateFiles() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  for (const name of ["bot_state.json", "gmx_cache.json"]) {
    const file = path.join(STATE_DIR, name);
    try { await fs.access(file); }
    catch { await fs.writeFile(file, "{}\n", "utf8"); }
  }
}

async function readStore(namespace) {
  const file = path.join(STATE_DIR, `${namespace}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) { return {}; }
}

async function writeStore(namespace, store) {
  const file = path.join(STATE_DIR, `${namespace}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

function makeFileKvBinding(namespace) {
  return {
    async get(key, type) {
      const store = await readStore(namespace);
      const entry = store[String(key)];
      if (!entry) return null;
      if (entry.expiresAt && Date.now() >= entry.expiresAt) {
        delete store[String(key)];
        await writeStore(namespace, store);
        return null;
      }
      const value = entry.value;
      if (type === "json") {
        if (typeof value === "string") { try { return JSON.parse(value); } catch (_) { return null; } }
        return value ?? null;
      }
      return value ?? null;
    },
    async put(key, value, options = {}) {
      const store = await readStore(namespace);
      let stored = value;
      if (typeof value === "string") { try { stored = JSON.parse(value); } catch (_) {} }
      const ttl = Number(options?.expirationTtl || 0);
      store[String(key)] = { value: stored, expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null };
      await writeStore(namespace, store);
    }
  };
}

function envValue(name, fallback = "") { return process.env[name] ?? fallback; }

async function buildEnv() {
  await ensureStateFiles();
  return {
    ARBITRUM_RPC: envValue("ARBITRUM_RPC"),
    GMX_PRIVATE_KEY: envValue("GMX_PRIVATE_KEY"),
    TELEGRAM_TOKEN: envValue("TELEGRAM_TOKEN"),
    TELEGRAM_CHAT_ID: envValue("TELEGRAM_CHAT_ID"),
    EXECUTION_ENABLED: envValue("EXECUTION_ENABLED", "true"),
    EXPECTED_VERSION: envValue("EXPECTED_VERSION", EXPECTED_WORKER_VERSION),
    BOT_STATE: makeFileKvBinding("bot_state"),
    GMX_CACHE: makeFileKvBinding("gmx_cache")
  };
}

async function main() {
  const env = await buildEnv();
  const scheduledTime = Date.now();
  const actualVersion = BOT_VERSION || "UNKNOWN";
  console.log("[GITHUB][START]", {
    scheduledTime,
    worker: "worker_core.mjs",
    expectedVersion: env.EXPECTED_VERSION,
    actualWorkerVersion: actualVersion,
    build: BOT_BUILD || "UNKNOWN",
    executionEnabled: env.EXECUTION_ENABLED,
    executionEnabledSource: process.env.EXECUTION_ENABLED == null ? "runner-default-true" : "github-env"
  });
  if (actualVersion !== env.EXPECTED_VERSION) {
    throw new Error(`WORKER_VERSION_MISMATCH: expected=${env.EXPECTED_VERSION} actual=${actualVersion}`);
  }
  if (typeof worker.scheduled !== "function") throw new Error("WORKER_SCHEDULED_EXPORT_MISSING");
  await worker.scheduled({ cron: "* * * * *", scheduledTime }, env, {
    waitUntil(promise) { return promise; }
  });
  console.log("[GITHUB][DONE]", { scheduledTime, worker: "worker_core.mjs", version: actualVersion });
}

main().catch((error) => {
  console.error("[GITHUB][FATAL]", error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
