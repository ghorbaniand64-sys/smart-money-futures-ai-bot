Hyperliquid Meme Hunter V8.6.9 — FIXED-3 SAFE LIVE EXECUTION

Fixed traders (rotation OFF):
1) 0x64b766b07362405a9cc19c2226490f3015929da9
2) 0xe639710e64d7094f7f82ab495915559c2f612953
3) 0xe86b057f5eb764c9738d6b0d38170befd0723664

Key fixes:
- Fixed-3 execution is no longer blocked by the generic Meme Specialist breadth gate.
- Single-token concentration remains a soft risk factor.
- PnL reconstruction integrity now recognizes position-lifecycle boundaries outside the fetched history window.
- Genuine lifecycle/data-integrity failures remain hard execution blocks.
- Final fixed-copy candidates come from the same analyzed registry used by Deep History.
- Best current entry remains subject to current-position distance, RR, ATR/volatility and execution-readiness gates.
- Hunter remains READ-ONLY; execution is a separate engine.
- Execution Engine V8.6.9 is LIVE-capable but SAFE by default: EXECUTION_ENABLED=false and EXECUTION_DRY_RUN=true unless explicitly changed.
- PAPER_EXECUTION_ONLY=true is an emergency paper-only kill switch.
- Before live entry, the engine revalidates handoff age, source distance, direction, account balance, max 2 positions, duplicate orders, isolated leverage, and 50% margin cap.
- After a fill, both SL and TP must be accepted and have order IDs, and the position must be confirmed. Any protection/confirmation failure triggers emergency close.
- Self-test: EXECUTION_SELF_TEST=true node hyperliquid_execution_engine.mjs. This submits no network order.

V8.6.8 changes:
- Fixed-3 Entry Selection now displays trader entry/current price with adaptive precision.
- Correctly preserves zero-valued numeric fields instead of converting them to NaN.
- Shows WAITING when the only current-entry blocker is distance > 0.5%, including the remaining distance needed to reach the gate.
- Shows BLOCKED when other hard blockers remain.
- Worker remains READ-ONLY; it creates no live orders itself.
