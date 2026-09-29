CRYPTO WHALE SIGNAL ENGINE V1.8
- Read-only, no private keys, no orders, no execution.
- Exactly 5 Spot + 5 Futures.
- Spot: 60 recent signatures, quote-backed BUY reconstruction, $1000 minimum BUY, 48h freshness, batching/retries.
- Futures: opening-fill freshness detection; missing open time is OPEN_TIME_UNKNOWN rather than falsely POSITION_TOO_OLD.
- Telegram: compact COPY NOW / WATCH / NO ENTRY dashboard.
- Spot source entry remains reconstructed on-chain quote spend / token received, not a guaranteed DEX fill.
