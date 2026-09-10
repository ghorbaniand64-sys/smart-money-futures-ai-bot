import worker, { BOT_VERSION, BOT_BUILD } from "./worker_core.mjs";
const EXPECTED_WORKER_VERSION = "V18.1.0-CLEAN-HYBRID-FAST-REACTION";
if(BOT_VERSION!==EXPECTED_WORKER_VERSION) throw new Error(`WORKER_VERSION_MISMATCH: expected=${EXPECTED_WORKER_VERSION} actual=${BOT_VERSION}`);
console.log("[GITHUB][RUNNER_IDENTITY]",{version:BOT_VERSION,build:BOT_BUILD,worker:"worker_core.mjs"});
await worker.scheduled(process.env);
