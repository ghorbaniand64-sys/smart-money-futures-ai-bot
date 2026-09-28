CRYPTO WHALE SIGNAL ENGINE V1.4
===============================
READ-ONLY / SIGNAL-ONLY / NO ORDERS / NO EXECUTION

V1.4 changes:
- Spot and Futures are explicitly separated in Telegram.
- ENTRY READY, NEAR ENTRY and TOO LATE are separated by market.
- Each Spot trader has a dedicated Health header immediately followed by that trader's current positions.
- Each Futures trader has a dedicated Health header immediately followed by that trader's current positions.
- Every current position shows trader, coin, side, current price, source entry, distance, SL, TP, RR and (when available) leverage/position value/uPnL.
- Health and entry status are intentionally independent: a HEALTHY trader may have a TOO LATE position, while a WATCH/RISKY trader may have a technically near-entry position.
- No private keys, order placement, leverage changes, SL/TP orders or execution handoff.

Worker:
crypto_whale_signal_engine.mjs

Workflow:
.github/workflows/crypto-whale-signal-engine.yml
