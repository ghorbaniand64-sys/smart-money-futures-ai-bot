# GFTSH — 10 Wallet Live Futures Observer

## What it does

- Watches exactly 10 Hyperliquid perpetual-futures wallets.
- Intended schedule: every 15 minutes.
- Detects a genuinely NEW position:
  - flat -> LONG/SHORT
  - LONG -> SHORT or SHORT -> LONG (flip)
- Ignores same-side adds / averaging.
- Requires the current `clearinghouseState` to confirm the position still exists.
- Reads current mark price from `allMids`.
- Reads leverage and entry from the source-native position.
- Uses the trader's publicly exposed TP/SL when available.
- Otherwise calculates Model TP/SL:
  - SL = 0.5% from entry
  - TP = 2R
- Reports distance from entry and RR.
- READ-ONLY: no orders, no copying, no execution.

## Important

The model TP/SL is NOT the trader's real TP/SL. The Telegram message labels the source:
`Trader TP/SL` or `Model TP/SL`.

## GitHub Actions

Use a 15-minute cron:

    */15 * * * *

Required GitHub Environment:
`production`

Required Secrets:
- TELEGRAM_TOKEN
- TELEGRAM_CHAT_ID

Optional Variables are listed in `gftsh_10_wallet_observer.env.example`.

## State

Commit these files after each successful run if the runner is ephemeral:

- production/state/gftsh_10_wallet_observer.json
- production/state/gftsh_10_wallet_telegram.json

The alert dedupe state is important: without persistence, a new GitHub runner could re-see the same fill.

## New-position rule

The critical rule is based on `startPosition` and the post-fill position:

- `startPosition == 0` and post-fill != 0 -> NEW POSITION
- nonzero same-side -> ADD / averaging -> IGNORE
- sign changes -> FLIP -> NEW POSITION

Partial fills after the first opening fill normally have a nonzero `startPosition`, so they do not generate repeated alerts.
