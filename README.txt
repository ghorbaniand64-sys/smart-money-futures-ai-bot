GFTSH V2.1.4 — GLOBAL FUTURES PRO HUNTER

Worker: crypto_whale_signal_engine.mjs
Workflow: .github/workflows/crypto-whale-signal-engine.yml
Mode: READ-ONLY / NO ORDERS / NO AUTO-COPY / FUTURES ONLY

V2.1.4 is a corrected diagnostic build. It restores the complete working HTTP,
leaderboard, fills and Telegram helpers and adds transparent audit diagnostics.

Key contracts:
- Hyperliquid leaderboard returns real 0x trader IDs.
- userFillsByTime is the historical trade authority.
- clearinghouseState is the current-position authority.
- Position increases are reconstructed from dir/startPosition/sz.
- Fresh signal activity is genuinely <=15 minutes.
- Entry distance <=0.75%; model SL 0.5%; TP 2R; RR >=1.5.
- Quality gate: closed trades >=8, WR >=60%, PF >=1.35 when available, DD <=25%.
- Up to 5 independent signals.
- HTTP 429/5xx/timeouts use bounded retry/backoff.
- Telegram failures cannot hide the primary engine failure.
- Diagnostic pipeline reports fills -> fresh -> position increase -> live match -> entry window -> quality.

Required production environment secrets:
TELEGRAM_TOKEN
TELEGRAM_CHAT_ID
Optional:
HYPERLIQUID_API_URL
HL_LEADERBOARD_URL
