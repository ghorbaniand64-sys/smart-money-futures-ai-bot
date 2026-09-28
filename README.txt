CRYPTO WHALE SIGNAL ENGINE V1.3

Signal-only Hyperliquid/Solana wallet monitor.

Files:
- crypto_whale_signal_engine.mjs
- .github/workflows/crypto-whale-signal-engine.yml

Replace the old worker with crypto_whale_signal_engine.mjs.
Replace the old Hyperliquid workflow with crypto-whale-signal-engine.yml.
Remove any old execution/copy-trading workflow and hyperliquid_execution_engine.mjs.

The engine is read-only: no orders, no private keys, no execution, no leverage changes.
It monitors 5 Spot + 5 Futures sources and sends a Telegram report every 5 minutes.

Entry classification:
- GREEN: within SIGNAL_MAX_ENTRY_DISTANCE_PCT (default 0.75%) and RR >= minimum.
- YELLOW: within SIGNAL_WATCH_DISTANCE_PCT (default 3%) but blocked.
- RED: farther than the watch window; do not enter.

Trader Health:
- Futures health is calculated dynamically from recent Hyperliquid fills over the
  configured lookback (default 30 days), using realized PnL, win rate, profit factor,
  and a minimum trade-count threshold.
- Spot health uses the current public 30-day audit baseline for the selected wallets.
  This is intentionally marked as a baseline, not a live realized-PnL calculation,
  because the public Solana RPC path in this engine is not a full DEX PnL accounting engine.
- Health is advisory and does not itself create an entry signal.

Spot source-entry values are reconstructed from on-chain balance changes and are diagnostic,
not guaranteed exchange/DEX fill prices. Futures entries come from current Hyperliquid
position state.

Environment variables:
- HYPERLIQUID_API_URL
- SOLANA_RPC_URL
- TELEGRAM_TOKEN
- TELEGRAM_CHAT_ID
- SIGNAL_MAX_ENTRY_DISTANCE_PCT
- SIGNAL_WATCH_DISTANCE_PCT
- SIGNAL_MIN_RR
- SIGNAL_SPOT_SL_PCT
- SIGNAL_SPOT_TP_PCT
- SIGNAL_FUTURES_SL_PCT
- SIGNAL_FUTURES_TP_PCT
- SIGNAL_HEALTH_LOOKBACK_DAYS
- SIGNAL_HEALTH_MIN_TRADES
