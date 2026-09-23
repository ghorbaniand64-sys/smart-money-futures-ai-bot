# Hyperliquid Listing Hunter V0.2 — Production

Read-only Hyperliquid market/listing monitor for GitHub Actions.

## Required Environment Secrets

GitHub → Settings → Environments → `production`:

- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

The workflow maps `TELEGRAM_TOKEN` to the worker's `TELEGRAM_BOT_TOKEN` variable.

## Important V0.2 fixes

- Sends an ONLINE Telegram test when the worker starts.
- Logs explicit Telegram configuration/send errors instead of silently swallowing them.
- Sends first-trade alerts even when there is no new market in the same cycle.
- Only reports the first observed trade per market; raw repeated trade messages are no longer treated as separate first trades.

## GitHub path

`.github/workflows/hyperliquid-listing-hunter.yml`
