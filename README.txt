HYPERLIQUID MEME HUNTER V8.5.12
READ-ONLY | NO ORDERS

Worker filename (required): hyperliquid_trader_hunter.mjs

V8.5.12 fixes the V8.5.8 history/promotion bottleneck without lowering Full-Copy gates.

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

V8.5.12 CHANGE
- Priority Deep History now runs before the expensive full-cycle scan.
- A configurable DEEP_HISTORY_RESERVE_MS (default 120000ms) protects verification time.
- Priority promotion-memory candidates are prefetched once and the same fills are reused by the analyzer.
- Promotion candidates are not made eligible by lowering any economic, timing, risk, evidence, or sample gate.
- Single-token specialists remain valid; concentration remains a soft factor.


V8.5.12 audit/fixes:
- Separates normal-scan budget reservation from external SAFE STOP state. The normal scan may stop early to reserve time for Deep History without disabling the Deep-History lane.
- Post-scan Deep History is executed from the reserved budget and can verify strong incomplete candidates discovered in the same cycle.
- Deep History selection can use strong evidence/sample even when incomplete history temporarily prevents the strict specialist flag.
- Timing audit uses a stratified historical sample instead of only the newest trades, reducing regime-selection bias.
- Current-position enrichment fetches all mids once per cycle instead of once per candidate.
- Single-token concentration remains a soft risk factor; no economic/profit/timing/risk/evidence gate is relaxed.
- READ-ONLY / NO ORDERS.
