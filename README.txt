HYPERLIQUID MEME HUNTER V8.5.9
READ-ONLY | NO ORDERS

Worker filename (required): hyperliquid_trader_hunter.mjs

V8.5.9 fixes the V8.5.8 history/promotion bottleneck without lowering Full-Copy gates.

Key changes:
- Deep History is an independent verification lane; it does not require repeat promotion cycles.
- VERIFIED_PARTIAL history is treated as sufficient for the history-completeness layer only when the deep scan has no rate-limit/network impact and has at least the configured minimum closed trades.
- FULL-COPY economic, profit, timing, risk, evidence and readiness thresholds remain unchanged.
- Single-token specialists remain eligible; concentration remains a soft/descriptive factor.
- finalCopyability correctly recognizes VERIFIED_PARTIAL history.
- evidenceDimensions now receives historyVerification explicitly; no implicit/undefined variable.
- Deep History Telegram statistics now report only actual deep-verification attempts/results.
- Promotion cycle count remains a research/promotion signal and cannot substitute for history verification.
- Deep target default reduced to 4 to protect the 480s runtime budget; override with HYPERLIQUID_MEME_DEEP_HISTORY_TARGET if needed.
- Deep history max pages remains 24; minimum closed trades remains 60.

Validation performed before delivery:
- node --check hyperliquid_trader_hunter.mjs
- ZIP integrity test

This worker remains read-only. It does not create orders.
