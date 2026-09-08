GMX V16.2.0 EXECUTION REPAIR

Replace these two files in the GitHub repository:
1) worker_core.js
2) github-runner.mjs

Important:
- The runner now executes the V16.2.0 worker_core.js.
- EXECUTION_ENABLED defaults to true when the GitHub environment variable is absent.
- An explicit EXECUTION_ENABLED=false/0/no/off still disables live execution as an emergency switch.
- Execution thresholds were NOT lowered.
- No arbitrary $10 minimum order was added.
- Runner cron event is aligned to * * * * *; the GitHub workflow schedule itself must also be changed if it currently runs every 5 minutes.
- Required GitHub secrets/env remain: ARBITRUM_RPC, GMX_PRIVATE_KEY, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID.

Validation performed:
- node --check worker_core.js: PASS
- node --check github-runner.mjs: PASS
- suspicious-command scan: CLEAN
