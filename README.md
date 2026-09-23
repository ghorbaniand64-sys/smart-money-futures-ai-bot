# Hyperliquid Listing Hunter V0.1 — GitHub Actions Setup

READ-ONLY / NO ORDERS.

## Files

- `hyperliquid_listing_hunter.mjs` — worker
- `github-runner.mjs` — bounded runner for GitHub Actions
- `.github/workflows/hyperliquid-listing-hunter.yml` — scheduled workflow
- `state/hyperliquid_listing_state.json` — persisted state (created on first run)

## Required GitHub Secrets

Add these repository secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

No Hyperliquid private key, wallet key, API key, or trading credential is required. The worker is read-only and uses public Hyperliquid REST/WebSocket endpoints.

## What it monitors

- Native Hyperliquid perpetual markets
- Native Hyperliquid spot markets
- HIP-3 perpetual markets
- Newly observed markets
- First observed perpetual trade through the Hyperliquid WebSocket trade stream

## Important timing note

`firstSeenAt` means the first time THIS monitor observed a market. It is not claimed to be the historical listing time if the monitor was offline.

`firstTradeObservedAt` means the first trade received by this monitor after subscription. V0.1 does not claim advance knowledge of future listings.

## Schedule

Runs every 5 minutes. Each invocation keeps the worker alive for about 3.5 minutes, persists state, and exits so the next scheduled run can continue from the saved state.
