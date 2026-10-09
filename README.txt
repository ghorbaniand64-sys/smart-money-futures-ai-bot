GFTSH 10 Wallet Observer — aligned package

Contents:
- gftsh_10_wallet_observer.mjs (place in repository root)
- .github/workflows/gftsh_10_wallet_observer.yml (keep this exact hidden-folder path)
- production/state/ (directory placeholder; JSON state files are created by the workflow)

Install by extracting the ZIP into the repository root and committing both files.
GitHub Actions schedule: */10 * * * *; observer interval: 10 minutes.
A cycle/status Telegram message is attempted after each successful scan. A trade signal is conditional:
an open position must be within 0.50% of its current average entry and meet the minimum notional.
GitHub Actions schedules are best-effort and can start late; no workflow can guarantee delivery at an exact time.
Required GitHub secrets: TELEGRAM_TOKEN and TELEGRAM_CHAT_ID.
Mode remains READ-ONLY: no orders and no auto-copy.
