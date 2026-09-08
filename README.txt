GMX V17.0.1 — SMART MONEY STRUCTURE ENGINE

Changes in this repair:
- Persistent GitHub Actions state via actions/cache restore/save.
- Breakout -> waiting retest -> retest confirmation now survives scheduled runs.
- Runner version alignment updated to V17.0.1.
- Structured diagnostics expose S/R, flow, volume, reactions, breakouts, retests, exhaustion and entries.
- Every scanned symbol is logged with structural state; WAITING_RETEST is no longer hidden.
- No score threshold was added or loosened.
- Top-trader confirmation remains non-blocking.
- Node 22 and GMX SDK 1.8.2 retained.

Deployment:
Replace worker_core.js, github-runner.mjs, package.json and .github/workflows/gmx-bot.yml with the files in this package.
The workflow expects the production Environment and these secrets:
ARBITRUM_RPC, GMX_PRIVATE_KEY, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID.
