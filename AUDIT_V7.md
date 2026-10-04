# Crypto Whale Signal Engine V7.0 — Final Audit

## Fixed
- Spot discovery no longer depends exclusively on Helius.
- Helius rate-limit/circuit-open now falls back to Solana RPC activity discovery.
- Spot discovery merges fresh candidates with cached candidates instead of replacing a partial result.
- Spot signal scanning falls back from Helius to Solana RPC when Helius is rate-limited.
- Hyperliquid market-context failure/429 is no longer interpreted as zero volume/OI.
- Futures can use `markPx` from `clearinghouseState` when `allMids` is unavailable.
- Discovery cache is stable at 5+5 once target is reached, avoiding unnecessary deep refreshes every cycle.
- Read-only execution remains hard-disabled.

## Preserved
- Verified / Emerging / Active Watch tiers.
- Fresh ADD / NEW ENTRY lifecycle labeling.
- Entry/Watch distance windows.
- RR >= 2.
- Partial-performance reporting without fake zero performance.
- Telegram deduplication.
- Existing state/cache file names.

## Safety
- `EXECUTION_ENABLED=false`
- `DRY_RUN=true`
- No order endpoint is called by the worker.

## Validation
- `node --check` PASS
- V7 self-test PASS
