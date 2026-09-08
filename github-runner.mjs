// Smart Money Futures AI Bot — GitHub Actions adapter
// V17.0.1-GITHUB-ACTIONS-EXECUTION-ALIGNMENT
// Runs one complete scheduled cycle using the deployed V17.0.1 engine.
// Persistent Cloudflare KV bindings are emulated with JSON files in ./state.

import fs from "node:fs/promises";
import path from "node:path";
import worker from "./worker_core.js";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, "state");

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
  } catch (_) {
    return {};
  }
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
        if (typeof value === "string") {
          try { return JSON.parse(value); } catch (_) { return null; }
        }
        return value ?? null;
      }
      return value ?? null;
    },
    async put(key, value, options = {}) {
      const store = await readStore(namespace);
      let stored = value;
      if (typeof value === "string") {
        try { stored = JSON.parse(value); } catch (_) {}
      }
      const ttl = Number(options?.expirationTtl || 0);
      store[String(key)] = {
        value: stored,
        expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null
      };
      await writeStore(namespace, store);
    }
  };
}

function envValue(name, fallback = "") {
  return process.env[name] ?? fallback;
}

async function buildEnv() {
  await ensureStateFiles();
  return {
    ARBITRUM_RPC: envValue("ARBITRUM_RPC"),
    GMX_PRIVATE_KEY: envValue("GMX_PRIVATE_KEY"),
    TELEGRAM_TOKEN: envValue("TELEGRAM_TOKEN"),
    TELEGRAM_CHAT_ID: envValue("TELEGRAM_CHAT_ID"),
    EXECUTION_ENABLED: envValue("EXECUTION_ENABLED", "true"),
    BOT_STATE: makeFileKvBinding("bot_state"),
    GMX_CACHE: makeFileKvBinding("gmx_cache")
  };
}

async function main() {
  const env = await buildEnv();
  const scheduledTime = Date.now();
  const event = { cron: "* * * * *", scheduledTime };
  console.log("[GITHUB][START]", {
    scheduledTime,
    worker: "worker_core.js",
    expectedVersion: "V17.0.1-SMART-MONEY-STRUCTURE-ENGINE",
    executionEnabled: env.EXECUTION_ENABLED,
    executionEnabledSource: process.env.EXECUTION_ENABLED == null ? "runner-default-true" : "github-env"
  });

  await worker.scheduled(event, env, {
    waitUntil(promise) { return promise; }
  });

  console.log("[GITHUB][DONE]", { scheduledTime });
}

main().catch((error) => {
  console.error("[GITHUB][FATAL]", error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
