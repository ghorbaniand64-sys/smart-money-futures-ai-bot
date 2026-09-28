CRYPTO WHALE SIGNAL ENGINE V1.0

Replace the old hyperliquid_trader_hunter.mjs with the included file.
Install the included workflow at .github/workflows/hyperliquid-signal-engine.yml.

READ-ONLY ONLY: no orders, no private keys, no execution engine, no execution handoff.
Exactly 5 Spot + 5 Futures sources are scanned every workflow cycle.
Telegram is emitted once per cycle; schedule is every 5 minutes, offset to minute 1.
Spot signals require a currently held SPL token plus a recent observed buy. Spot source entry is reconstructed from on-chain SOL/token balance deltas and is diagnostic.
Futures signals use live Hyperliquid positions, live mid, source entry, distance, SL, TP and RR.
Remove the old execution-engine file/workflow from the repository; it is intentionally absent from this package.
