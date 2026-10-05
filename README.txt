GFTSH V2.1.5 — GLOBAL FUTURES PRO HUNTER

Worker: crypto_whale_signal_engine.mjs
Workflow: .github/workflows/crypto-whale-signal-engine.yml
Mode: READ-ONLY / NO ORDERS / NO AUTO-COPY / FUTURES ONLY

V2.1.5 changes
- Activity-first audit: probe only the last freshness window first.
- Full 7-day fill history is fetched only for traders with fresh position-increasing activity.
- clearinghouseState is queried only after fresh activity is confirmed.
- Global 429 cooldown prevents a thundering herd of retries.
- Minimum inter-request gap and bounded concurrency protect Hyperliquid API limits.
- Freshness remains real <=15 minutes; it is never synthesized.
- Current position remains clearinghouseState-only.
- Quality gates remain strict: closed trades, WR, PF, DD, anomaly guard.
- PF unavailable never becomes LOW_PF.
- Multiple independent signals remain supported.

Why this architecture
Hyperliquid documents a 1200-weight/minute REST limit per IP. userFills/userFillsByTime have base weight 20 plus additional weight per 20 returned items; clearinghouseState has weight 2. V2.1.5 therefore avoids historical fills and state calls for inactive traders.

Production secrets (GitHub Environment: production)
- TELEGRAM_TOKEN = Telegram bot token
- TELEGRAM_CHAT_ID = destination chat ID
- HYPERLIQUID_API_URL = https://api.hyperliquid.xyz/info (optional)
- HL_LEADERBOARD_URL = https://stats-data.hyperliquid.xyz/Mainnet/leaderboard (optional)
