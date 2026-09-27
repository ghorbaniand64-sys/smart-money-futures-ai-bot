HYPERLIQUID MEME HUNTER V8.5.18
READ-ONLY | NO ORDERS

Final integrity-focused release based on V8.5.17.

Key changes:
- Deep History remains connected to the same final analyzed candidate object.
- Adds explicit PnL reconstruction integrity: reconstructed lifecycle PnL is compared with Hyperliquid closedPnl.
- Adds exact specialist-gate diagnostics (single-token and multi-meme criteria) instead of only SPECIALIST_GATE_BLOCKED.
- Records history integrity metadata and the reconstructed-vs-raw PnL delta.
- Treats Hyperliquid API history as an API-window limitation; COMPLETE means complete within the queried API window, not proof of unlimited all-time history.
- Single-token specialists remain valid; concentration is a soft risk factor and never a hard blocker.
- No economic, timing, risk, evidence, or sample gate is relaxed to manufacture candidates.
- Read-only. No orders are created.

Worker filename (required): hyperliquid_trader_hunter.mjs
Execution helper: hyperliquid_execution_engine.mjs
