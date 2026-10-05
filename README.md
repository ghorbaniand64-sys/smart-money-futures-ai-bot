# GFTSH V2.1.1

`GFTSH-V2.1.1-GLOBAL-FUTURES-ACTUAL-TRADE-RECON-V2`

Read-only futures hunter. No orders. No auto-copy.

## V2.1.1 changes

- Actual closed trade lifecycle is the performance unit.
- Partial fills / adds are aggregated into one lifecycle.
- Current position authority comes from Hyperliquid `clearinghouseState`.
- Trader Quality and Current Position Quality are separate gates.
- PF unavailable is distinct from LOW_PF.
- PF/WR anomaly guard flags suspicious combinations instead of fabricating zeroes.
- Every blocked current position has an explicit reason.
- Nullable metrics use safe formatting and cannot call `toFixed()` on null.
- Missing current position is reported as `NO_CURRENT_POSITION`.
- Entry distance gate is 0.5% by default.
- Model SL is 0.5%, TP is 2R.

## Required GitHub Environment: production

Secrets:

- `HYPERLIQUID_API_URL` = `https://api.hyperliquid.xyz/info`
- `TELEGRAM_TOKEN` = your Telegram bot token
- `TELEGRAM_CHAT_ID` = your Telegram chat ID

No private key is required. This worker cannot place orders.

## Optional configuration

- `GFTSH_LOOKBACK_DAYS` default `30`
- `GFTSH_LEADERBOARD_LIMIT` default `400`
- `GFTSH_AUDIT_LIMIT` default `100`
- `GFTSH_TOP_WATCH` default `10`
- `GFTSH_FILL_MAX_PAGES` default `20`
- `GFTSH_MAX_ENTRY_DISTANCE_PCT` default `0.5`
- `GFTSH_MODEL_SL_PCT` default `0.5`
- `GFTSH_MODEL_TP_R` default `2`
- `GFTSH_SIGNAL_FRESHNESS_MIN` default `15`

The non-Hyperliquid venues remain discovery-only unless an independently verified public trader-data adapter is configured. They never become actionable from discovery alone.
