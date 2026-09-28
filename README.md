# Crypto Whale Signal Engine V1.6.1

READ-ONLY / SIGNAL-ONLY. No orders, private keys, leverage changes, or execution.

## Fixes in V1.6.1
- Fixed a null-health reporting crash: empty history values are no longer treated as numeric zero.
- Spot Solana `getTransaction` calls now use small batches and exponential retry/backoff for HTTP 429.
- Spot scanning stops gracefully after repeated RPC failures and marks the history as partial instead of killing the whole cycle.
- Default Spot signature scan reduced from 60 to 40 to lower public-RPC pressure; workflow explicitly sets the same value.
- Futures quality logic from V1.6 remains: recent position-add activity, ATR/structure SL, RR, liquidation-distance, and adverse/favorable move filters.

## Important
A partial Spot RPC scan is not treated as proof that a wallet has no signal. The Telegram report should be read together with the `partialHistory`/data-error information.
