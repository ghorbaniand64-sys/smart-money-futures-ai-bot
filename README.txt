GMX V16.2.0 — COMPLETE GITHUB DEPLOYMENT PACKAGE
================================================

Files included:
- worker_core.js              V16.2.0 execution engine
- github-runner.mjs          GitHub Actions runner
- package.json               Node >=22 + @gmx-io/sdk 1.8.2
- .github/workflows/gmx-bot.yml  scheduled/manual workflow

IMPORTANT SDK FIX
------------------
The worker is ESM, but the published GMX SDK supports CommonJS loading.
The SDK imports are therefore loaded through node:module createRequire().
This avoids Node ESM resolution failure at @gmx-io/sdk/build/esm/src/configs/api.

SDK version remains 1.8.2. No downgrade/upgrade is required.

INSTALL
-------
The workflow uses `npm install`, not `npm ci`, because this deployment package
intentionally does not require a pre-generated package-lock.json.

NODE
----
GitHub Actions uses Node.js 22.

EXECUTION
---------
EXECUTION_ENABLED is explicitly set to "true" in the workflow.
The worker still honors an explicit false/off value as an emergency shutdown.

SECRETS REQUIRED
----------------
ARBITRUM_RPC
GMX_PRIVATE_KEY
TELEGRAM_TOKEN
TELEGRAM_CHAT_ID

SCHEDULE
--------
The workflow is scheduled every 5 minutes and can also be started manually
with Run workflow.

VALIDATION
----------
worker_core.js and github-runner.mjs pass Node syntax checks.
The SDK import change follows GMX's documented CommonJS support for
@gmx-io/sdk/v2 and @gmx-io/sdk/configs/chains.
