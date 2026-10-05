# GFTSH V2 Workflow

Exact destination in the repository:
`.github/workflows/crypto-whale-signal-engine.yml`

GitHub Environment:
`production`

Required secrets:
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

The workflow runs every 5 minutes and keeps a persistent verified-trader cache in:
- `state/global_futures_hunter.json`
- `state/global_futures_cache.json`

No exchange private API keys are required by this read-only build.
