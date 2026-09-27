HYPERLIQUID MEME HUNTER V8.5.16

READ-ONLY / NO ORDERS

Changes from V8.5.15:
- Unified candidate pipeline retained: Deep History results are re-analyzed through the normal specialist/copy/execution gates.
- Added Deep-History Recovery for rate-limit/network/partial-history failures with bounded retries and time budget protection.
- Recovery never relaxes specialist, copyability, risk, evidence, or execution gates.
- Single-token specialists remain eligible; concentration remains a soft risk factor.
- Promotion repeat-cycle state remains separate from Final Copy eligibility.
- Exact worker filename: hyperliquid_trader_hunter.mjs

Default recovery settings:
- HYPERLIQUID_MEME_DEEP_HISTORY_RECOVERY_RETRIES=2
- HYPERLIQUID_MEME_DEEP_HISTORY_RECOVERY_MIN_REMAINING_MS=45000

Execution remains READ-ONLY / NO ORDERS. Paper execution logic may be present in the engine, but this worker does not submit live orders.
