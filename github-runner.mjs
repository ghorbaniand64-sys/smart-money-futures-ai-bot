import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import worker, { BOT_VERSION, BOT_BUILD } from "./worker_core.mjs";

const WORKER_PATH = path.join(process.cwd(), "worker_core.mjs");
async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function main() {
  const artifact = await fs.readFile(WORKER_PATH, "utf8");
  const workerSha256 = await sha256(WORKER_PATH);
  const legacyHardGateTokens = [
    "PURE_1H_ONLY_TIMEFRAME",
    "GLOBAL_MARKET_DIRECTION_NOT_CONFIRMED",
    "BTC_ETH_SOL_DIRECTION_DISAGREEMENT",
    "D1_H4_CONTEXT_NOT_ALIGNED"
  ];
  const legacyTokensPresent = legacyHardGateTokens.filter(token => artifact.includes(token));
  console.log("[GITHUB][WORKER_ARTIFACT]", {
    bytes: artifact.length, sha256: workerSha256,
    version: BOT_VERSION, build: BOT_BUILD,
    h1DirectionAuthority: true, macroSoftOnly: true,
    legacyTokensPresent
  });
  await worker.scheduled(
    { cron:"* * * * *", scheduledTime:Date.now() },
    {...process.env, EXECUTION_ENABLED:String(process.env.EXECUTION_ENABLED || "true")},
    { waitUntil(p){ return Promise.resolve(p); } }
  );
}
main().catch(e => { console.error("[GITHUB][FATAL]", e?.stack || e); process.exit(1); });
