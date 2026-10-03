CRYPTO WHALE SIGNAL ENGINE V6.7
================================
Drop-in Worker replacement for the permanent workflow:
.github/workflows/crypto-whale-signal-engine.yml

REQUIRED FILE NAME
------------------
crypto_whale_signal_engine.mjs

MODE
----
READ-ONLY / SIGNAL-ONLY
NO ORDERS
NO EXECUTION
NO LEVERAGE CHANGES

V6.7 AUDIT FIXES
----------------
1. Helius 429 / max-usage circuit breaker.
   - 429 no longer becomes trades=0 / WR=0 / PF=0.
   - Historical performance is marked unavailable instead of rejected.
   - Repeated Helius calls are stopped for a cooldown window.

2. Spot discovery recovery.
   - Recent decoded BUY activity can keep a wallet in ACTIVE_WATCH when history is unavailable.
   - Verified and Active Watch remain separate tiers.
   - Existing cached watchlists are preserved if a refresh fails.

3. Spot signal fallback.
   - When Helius is rate-limited, recent Spot activity can be inspected through Solana RPC as a signal-only fallback.

4. Performance integrity.
   - Rate-limited/failed performance is never cached as an empty zero-performance record.
   - Existing valid performance cache can be retained as stale rather than replaced by zeros.

5. Futures lifecycle integrity.
   - The old 120-minute observed add count is no longer presented as a fake lifecycle ADD #N.
   - NEW ENTRY is used only when the actual fill starts from zero.
   - Otherwise the report uses FRESH ADD / FRESH AVERAGING.

6. Full 10-wallet visibility.
   - Telegram includes a WATCHLIST AUDIT section listing every selected Spot and Futures wallet.
   - Verified and Active Watch counts are explicit.

7. Signal quality remains strict.
   - Futures freshness <= 15m.
   - Entry distance <= configured entry window.
   - RR >= configured minimum.
   - Meaningful add notional required.
   - Market liquidity gate remains active.

VALIDATION
----------
node --check: PASS
WHALE_SELF_TEST=true: PASS
Permanent workflow contract tokens: PASS

IMPORTANT
---------
Do NOT rename or replace the permanent workflow just for V6.7.
Replace only the repository root file:
crypto_whale_signal_engine.mjs

The permanent workflow is intentionally version-agnostic and should continue to run future V6.x workers.
