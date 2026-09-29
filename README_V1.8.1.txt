CRYPTO WHALE SIGNAL ENGINE V1.8.1
RPC RESILIENCE + DATA INTEGRITY

Read-only / signal-only. No orders, no execution, no leverage changes.

Changes from V1.8:
- Solana 429-aware exponential backoff and wallet-level cooldown.
- Spot transaction reads are sequential/low-concurrency instead of 5 simultaneous getTransaction calls.
- Spot scan stops early when all currently-held tokens have a recent valid quote-backed BUY, or when the transaction history becomes older than the stale window.
- Hard cap on Spot getTransaction requests per wallet.
- A Solana 429 no longer gets retried repeatedly; the wallet is marked partial/data-incomplete.
- Partial Spot data is never silently presented as a clean "no entry" result.
- Futures opening-time lookup is consolidated to one userFillsByTime call per wallet instead of one call per position.
- Futures state/mids/fill-data failures are separated and surfaced as DATA INCOMPLETE.
- OPEN_TIME_UNKNOWN is distinct from POSITION_OLD.
- Telegram now reports Spot/Futures data completeness separately.
- No private keys, no orders, no execution.
