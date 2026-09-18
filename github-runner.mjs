// GMX Smart Money Futures AI Bot — GitHub Actions adapter
// V23.1.0: canonical worker + fail-fast artifact integrity checks.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import worker, { BOT_VERSION, BOT_BUILD } from "./worker_core.mjs";

const ROOT = process.cwd();
const WORKER_PATH = path.join(ROOT, "worker_core.mjs");
const EXPECTED_WORKER_VERSION = BOT_VERSION;

async function sha256File(file) {
  const buf = await fs.readFile(file);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function ensureStateFiles() {
  const dir = path.join(ROOT, "state");
  await fs.mkdir(dir, { recursive: true });
  for (const name of ["bot_state.json", "gmx_cache.json"]) {
    const file = path.join(dir, name);
    try { await fs.access(file); } catch { await fs.writeFile(file, "{}\n", "utf8"); }
  }
}

async function main() {
  await ensureStateFiles();
  const artifact = await fs.readFile(WORKER_PATH, "utf8");
  const workerSha256 = await sha256File(WORKER_PATH);

  if (/PURE_1H_ONLY_TIMEFRAME/.test(artifact)) {
    throw new Error("STALE_WORKER_ARTIFACT: legacy 1H-only timeframe guard detected");
  }
  if (/GLOBAL_MARKET_DIRECTION_NOT_CONFIRMED|BTC_ETH_SOL_DIRECTION_DISAGREEMENT/.test(artifact)) {
    throw new Error("STALE_WORKER_ARTIFACT: hard BTC/ETH/SOL macro blocker detected");
  }
  if (/D1_H4_CONTEXT_NOT_ALIGNED|CONTINUATION_MUST_FOLLOW_MARKET_REGIME|REVERSAL_MUST_COUNTER_GLOBAL_REGIME/.test(artifact)) {
    throw new Error("STALE_WORKER_ARTIFACT: hard D1/H4 or macro direction gate detected");
  }

  console.log("[GITHUB][WORKER_ARTIFACT]", {
    path: WORKER_PATH,
    bytes: artifact.length,
    sha256: workerSha256,
    expectedVersion: EXPECTED_WORKER_VERSION,
    actualWorkerVersion: BOT_VERSION,
    build: BOT_BUILD,
    softMacro: true,
    h1DirectionAuthority: true
  });

  if (BOT_VERSION !== EXPECTED_WORKER_VERSION || BOT_BUILD !== EXPECTED_WORKER_VERSION) {
    throw new Error(`WORKER_VERSION_MISMATCH:${BOT_VERSION}:${BOT_BUILD}:${EXPECTED_WORKER_VERSION}`);
  }

  const executionEnabled = String(process.env.EXECUTION_ENABLED || "").toLowerCase() === "true";
  const scheduledTime = Date.now();

  const env = {
    ...process.env,
    EXECUTION_ENABLED: executionEnabled ? "true" : "false"
  };

  console.log("[GITHUB][START]", {
    scheduledTime,
    worker: "worker_core.mjs",
    expectedVersion: EXPECTED_WORKER_VERSION,
    actualWorkerVersion: BOT_VERSION,
    build: BOT_BUILD,
    workerSha256,
    executionEnabled: env.EXECUTION_ENABLED
  });

  await worker.scheduled(
    { cron: "* * * * *", scheduledTime },
    env,
    { waitUntil(p) { return Promise.resolve(p); } }
  );

  console.log("[GITHUB][END]", { version: BOT_VERSION, workerSha256 });
}

main().catch((err) => {
  console.error("[GITHUB][FATAL]", err?.stack || err);
  process.exit(1);
});
