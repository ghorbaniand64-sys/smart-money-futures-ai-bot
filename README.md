# Smart Money Futures AI Bot — V15.6.4 GitHub Actions

This package is the GitHub-specific deployment adapter for the existing V15.6.4 engine.

## What changed

- The trading/data/radar engine remains in `worker_core.js`.
- Cloudflare Worker runtime bindings are replaced by a GitHub Actions runner in `github-runner.mjs`.
- Cloudflare KV-style `BOT_STATE` and `GMX_CACHE` are emulated by JSON files under `state/` and committed back to the repository after each run.
- Execution is **OFF by default**. Set the GitHub Actions variable `EXECUTION_ENABLED=true` only after validation.
- The scheduled workflow runs every 5 minutes because GitHub Actions scheduled workflows have a 5-minute minimum interval.

## GitHub setup — do these in order

### 1. Create/use the repository

Put these files at the repository root:

- `worker_core.js`
- `github-runner.mjs`
- `package.json`
- `.gitignore`
- `state/bot_state.json`
- `state/gmx_cache.json`
- `.github/workflows/bot.yml`

### 2. Add Actions Secrets

Repository → **Settings → Secrets and variables → Actions → Secrets**

Create:

- `ARBITRUM_RPC`
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GMX_PRIVATE_KEY` — only if live execution will eventually be enabled.

Never put these values directly in source code.

### 3. Add Actions Variable

Repository → **Settings → Secrets and variables → Actions → Variables**

Create:

- Name: `EXECUTION_ENABLED`
- Value: `false`

Keep it `false` for the first validation phase.

### 4. Push to the default branch

The scheduled workflow runs from the repository's default branch.

### 5. Test manually first

Open **Actions → Smart Money Futures AI Bot V15.6.4 → Run workflow**.

Confirm the run finishes successfully.

### 6. Check Telegram

Validate:

- OI coverage
- funding coverage
- radar coverage/direction
- Smart Money parsing
- signal notifications
- no unexpected execution

### 7. Only after validation: live execution

Change the Actions variable:

`EXECUTION_ENABLED=false` → `true`

Do not enable live execution until the paper/data validation is clean.

## Important GitHub limitation

The workflow schedule is every 5 minutes, not every minute. GitHub documents 5 minutes as the shortest scheduled-workflow interval.

For a **private GitHub Free repository**, GitHub currently includes 2,000 standard-runner minutes/month, and private-repository job minutes are rounded up to the next minute. A 5-minute schedule can therefore exceed the free allowance. Public repositories using standard GitHub-hosted runners are free, but making the trading source public is a security/privacy decision.

## State design

The engine expects Cloudflare-style key/value bindings. The adapter provides the same `get()` / `put()` interface, but stores state in:

- `state/bot_state.json`
- `state/gmx_cache.json`

The workflow commits state after each successful cycle. This is intentionally simple for the first GitHub migration. It should be replaced with a proper persistent store before treating GitHub Actions as a long-term high-frequency production scheduler.
