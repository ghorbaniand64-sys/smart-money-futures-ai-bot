# Hyperliquid Trader Hunter V5.15

READ-ONLY / NO ORDERS.

Pipeline:
Leaderboard -> fast prefilter -> statistical qualification -> 100 qualified -> deep scan -> 5 finalists -> 1 auto-selected.

Key changes:
- Version is consistently V5.15.
- No artificial delay between traders.
- Concurrent screening with configurable concurrency.
- Deep enrichment is restricted to qualified traders.
- Qualification gates are explicit hard gates.
- Hyperliquid explicit Open/Close direction is preferred during lifecycle reconstruction.
- No fake SL/TP/RR values are produced on invalid position data.
- Pipeline timing is reported to Telegram.

Defaults:
- qualified target: 100
- leaderboard prefilter: 500
- screen concurrency: 10
- deep concurrency: 6
- lookback: 7 days
- finalists: 5

Environment overrides:
HYPERLIQUID_HUNTER_QUALIFIED_TARGET
HYPERLIQUID_HUNTER_SCREEN_PREFILTER
HYPERLIQUID_HUNTER_SCREEN_CONCURRENCY
HYPERLIQUID_HUNTER_DEEP_CONCURRENCY
HYPERLIQUID_HUNTER_LOOKBACK_DAYS
HYPERLIQUID_HUNTER_FINALISTS

The worker remains READ-ONLY. No orders or private keys are used.
