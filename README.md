# Hyperliquid Listing Hunter V0.1 — Production GitHub Setup

This package is a separate read-only monitor from the existing Hyperliquid Trader Hunter.

## Required files

- `hyperliquid_listing_hunter.mjs` — Listing Hunter worker
- `github-runner.mjs` — bounded GitHub Actions runner
- `.github/workflows/hyperliquid-listing-hunter.yml` — GitHub Actions workflow
- `state/` — persistent listing state

## GitHub Environment

The workflow uses the GitHub Environment named `production`:

```yaml
environment: production
```

It expects these Environment Secrets under `production`:

- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

The workflow maps `TELEGRAM_TOKEN` to the worker's `TELEGRAM_BOT_TOKEN` variable.

## Workflow

- Schedule: every 5 minutes
- Manual run: enabled with `workflow_dispatch`
- Node.js: 22
- Worker runtime: about 3.5 minutes
- Read-only: no trading orders or private Hyperliquid credentials

## Important

The `WORKFLOW` folder is not used in this production package. The actual GitHub workflow is placed at:

`.github/workflows/hyperliquid-listing-hunter.yml`

When uploading to GitHub, preserve the `.github/workflows/` path exactly.
