GFTSH V2.1.4
GLOBAL FUTURES ACTUAL-TRADE RECON / DIAGNOSTIC MULTI-SIGNAL

Files:
- crypto_whale_signal_engine.mjs
- .github/workflows/crypto-whale-signal-engine.yml

Mode:
- READ-ONLY
- FUTURES ONLY
- NO ORDERS
- NO AUTO-COPY

V2.1.4 changes:
1. Preserves the working Hyperliquid leaderboard discovery contract.
2. Activity-first audit ranking using current-day and weekly activity.
3. Robust fill position reconstruction using dir + startPosition + sz + px + time.
4. Supports opens, adds, reductions, closes and direction flips without fabricating freshness.
5. clearinghouseState remains the sole authority for the live position.
6. Fresh signal activity remains <=15 minutes.
7. Adds an explicit audit pipeline: fills -> fresh activity -> position increase -> live-position match -> entry window -> quality gate.
8. Adds detailed error buckets for HTTP 429, HTTP 5xx, timeout, fills schema/API, state API and other failures.
9. Adds bounded exponential retry/backoff for transient Hyperliquid failures.
10. Separates trader-quality eligibility from current-position readiness.
11. Supports up to 5 independent actionable signals.
12. Nullable WR/PF/price values are rendered safely; no unsafe toFixed() calls.

Required GitHub Environment:
production

Secrets:
- TELEGRAM_TOKEN
- TELEGRAM_CHAT_ID
- HYPERLIQUID_API_URL (optional; defaults to Hyperliquid info API)
- HL_LEADERBOARD_URL (optional; defaults to Hyperliquid Mainnet leaderboard)
