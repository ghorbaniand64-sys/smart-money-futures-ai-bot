GFTSH V2.1.2

Worker filename (must remain exact):
crypto_whale_signal_engine.mjs

Workflow:
.github/workflows/crypto-whale-signal-engine.yml

Mode:
READ-ONLY / NO ORDERS / NO AUTO-COPY / FUTURES ONLY

Production environment secrets:
TELEGRAM_TOKEN = your Telegram bot token
TELEGRAM_CHAT_ID = your Telegram chat ID
HYPERLIQUID_API_URL = optional; leave unset to use https://api.hyperliquid.xyz/info
HL_LEADERBOARD_URL = optional; leave unset to use https://stats-data.hyperliquid.xyz/Mainnet/leaderboard

The engine never fabricates a signal. A signal requires:
1) real Hyperliquid trader ID from leaderboard discovery
2) actual reconstructed closed-trade evidence
3) trader quality gate
4) current position from clearinghouseState
5) fresh open activity
6) entry distance gate
7) model SL/TP and RR gate

Multiple independent signals can be emitted, up to 5 per cycle by default.
