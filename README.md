# Hyperliquid Trader Hunter V6.1 — Authoritative Fixed Bundle

- Worker: `hyperliquid_trader_hunter.mjs`
- Execution engine: `hyperliquid_execution_engine.mjs`
- Worker is READ-ONLY and never places orders.
- Candidate Memory persists at `state/meme_hunter_memory.json`.
- Worker writes `state/meme_execution_handoff.json` every cycle.
- No LiveReady candidate is a normal BLOCKED state, not a workflow failure.
- Execution engine defaults to DRY RUN / NO ORDERS.
- `EXECUTION_ENABLED=true` and `EXECUTION_DRY_RUN=false` are required before any live order path.
- The execution engine re-validates source position, direction, entry distance, account state, leverage, notional, ATR and RR.
- Protective TP/SL attachment is not automatically sent by the current live entry path; keep live execution disabled until that path is separately validated.
