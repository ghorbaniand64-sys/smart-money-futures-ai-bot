CRYPTO WHALE SIGNAL ENGINE V1.0

Signal-only Hyperliquid/Solana wallet monitor.

Files:
- crypto_whale_signal_engine.mjs
- .github/workflows/crypto-whale-signal-engine.yml

Replace the old worker with crypto_whale_signal_engine.mjs.
Replace the old Hyperliquid workflow with crypto-whale-signal-engine.yml.
Remove any old execution/copy-trading workflow and hyperliquid_execution_engine.mjs.

The engine is read-only: no orders, no private keys, no execution, no leverage changes.
It monitors 5 Spot + 5 Futures sources and sends a Telegram report every 5 minutes.

Spot source-entry values are reconstructed from on-chain balance changes and are diagnostic,
not guaranteed exchange/DEX fill prices. Futures entries come from current Hyperliquid
position state.
