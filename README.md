# Hyperliquid Listing Hunter V0.3

READ-ONLY research monitor. No private keys and no orders.

## What V0.3 does

- Discovers native Perps, native Spot and HIP-3 Perp markets.
- Detects markets that are newly observed by this monitor.
- Arms a small number of fresh Perp markets for real-time trade observation.
- Reports the first trade observed after the detector subscribes.
- Measures early behavior at T+5s, T+15s, T+30s and T+60s.
- Reports first price, current price, percentage move, cumulative size and trade count.
- Keeps the Telegram startup test so deployment/Secrets can be verified immediately.
- Uses the `production` GitHub Environment and existing `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` secrets.

## Important timing limitation

"First trade" means first trade observed after this monitor discovers the market and subscribes. It is not guaranteed to be the historical first trade if the monitor was offline or discovered the market late.

GitHub Actions cron is not a real-time daemon. For sub-second or very low-latency listing capture, a continuously running service is preferable.

## Files

- `hyperliquid_listing_hunter.mjs` — worker
- `github-runner.mjs` — bounded GitHub Actions runner
- `.github/workflows/hyperliquid-listing-hunter.yml` — workflow
- `state/hyperliquid_listing_state.json` — persisted state

## Required GitHub Environment

Environment name:

`production`

Environment secrets:

- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

The workflow passes them to the worker as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
