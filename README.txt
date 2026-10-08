GFTSH 10 Wallet Observer — V2.1.0 Queue + Lifecycle Fix

ZIP contents:
- gftsh_10_wallet_observer.mjs (replace the file at repository root)
- .github/workflows/gftsh_10_wallet_observer.yml (replace the workflow at this exact path)

Changes:
- Removes the self-healing sleep + gh workflow run chain; GitHub cron is the only scheduler.
- Keeps five-minute cron with a :02 offset.
- Uses a serialized concurrency group with queue: max; pending runs are queued instead of canceled.
- Fixes legacy alert migration so a prior base-key alert does not suppress a distinct close/reopen lifecycle.
- Keeps read-only mode; no orders or copy trading.

Required repository/environment settings remain TELEGRAM_TOKEN and TELEGRAM_CHAT_ID secrets in the production environment, plus any existing GFTSH/HYPERLIQUID variables.
