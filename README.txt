Hyperliquid Meme Hunter V8 - FIXED

Worker filename: hyperliquid_trader_hunter.mjs

FIX:
- Restored the V8 execution-handoff writer that was referenced by main() but missing from the previous ZIP.
- Restored V8 promotion-memory loader/updater and atomic JSON writer.
- Handoff path: state/meme_execution_handoff.json
- Promotion memory: state/meme_hunter_memory.json
- Handoff TTL: 600000 ms (10 minutes)
- Old handoff is invalidated at cycle start.
- Only executionReady=true + FULL-COPY-CANDIDATE can enter handoff.
- Research/Promotion tracking never relaxes hard copy gates.
- Execution engine treats NO_EXECUTION_HANDOFF, HANDOFF_EXPIRED and NO_LIVEREADY_CANDIDATE as safe blocks.
- READ-ONLY: no orders are created by the Hunter.

Validation:
- node --check hyperliquid_trader_hunter.mjs: PASS
- node --check hyperliquid_execution_engine.mjs: PASS
- Full API runtime was not executed in this build environment because @nktkas/hyperliquid is not installed here.
