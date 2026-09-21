# Hyperliquid Trader Hunter V15.5

READ-ONLY trader selection engine. No orders and no private keys.

## Pipeline
1. Load the full Hyperliquid leaderboard.
2. Use leaderboard PnL/ROI/volume only as a cheap pre-rank.
3. Deep-screen candidates using reconstructed 7-day fills until 100 traders pass the hard qualification rules (or the prefilter is exhausted).
4. Enrich the qualified pool with all current open positions, live book data and 1h ATR.
5. Rank the qualified pool by copyability and retain 5 finalists.
6. Auto-select at most one finalist that is currently COPY_READY.

## Important environment variables
- `HYPERLIQUID_HUNTER_QUALIFIED_TARGET=100`
- `HYPERLIQUID_HUNTER_DISCOVERY_PREFILTER=2500`
- `HYPERLIQUID_HUNTER_FINALISTS=5`
- `HYPERLIQUID_HUNTER_LOOKBACK_DAYS=7`
- `HYPERLIQUID_HUNTER_MIN_7D_TRADES=30`
- `HYPERLIQUID_HUNTER_MIN_7D_WIN_RATE=65`
- `HYPERLIQUID_HUNTER_MIN_7D_PNL=0`
- `HYPERLIQUID_HUNTER_MIN_PROFIT_FACTOR=1.5`
- `HYPERLIQUID_HUNTER_MIN_ACTIVE_DAYS=4`
- `HYPERLIQUID_HUNTER_MAX_LOSING_STREAK=8`
- `HYPERLIQUID_HUNTER_MAX_LIQUIDATIONS=1`

`DISCOVERY_PREFILTER` is deliberately larger than 100 because the first 100 leaderboard rows are not guaranteed to contain 100 traders who pass the fill-based qualification gate.
