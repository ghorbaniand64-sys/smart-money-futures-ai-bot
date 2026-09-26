Hyperliquid Meme Hunter V8.5.5
READ-ONLY / NO ORDERS

Base: V8.5.4

V8.5.5 changes:
- Budgeted Deep Scan: default runtime budget 480s with a 45s safety reserve.
- Default full-history target reduced from 40 to 32 to avoid workflow cancellation while preserving protected Opportunity Pool slots.
- Opportunity Pool remains protected across cycles; strict specialist and Full-Copy gates are unchanged.
- Periodic atomic Opportunity Pool checkpoints every 4 analyzed traders.
- Cycle interruption/budget stop writes a safe BLOCKED execution handoff with zero candidates.
- SIGTERM/SIGINT are treated as safe-stop signals after the current request.
- Fixed Telegram compact report scope bug for opportunityPool.
- Duplicate same-cycle Opportunity Pool observations no longer inflate cyclesSeen.
- Execution handoff TTL remains 600000ms by default.

Required worker filename:
hyperliquid_trader_hunter.mjs

No live orders are created by this worker.
