HYPERLIQUID MEME HUNTER V8.5.17 — FINAL ARCHITECTURE

READ-ONLY | NO ORDERS

Worker filename (required): hyperliquid_trader_hunter.mjs

V8.5.17 FINAL FIXES
- Deep History results are authoritative in the unified analyzed registry used by Final Copy.
- Promotion Memory is synchronized from the same final registry, including strict specialists, so stale HISTORY_UNVERIFIED records cannot survive verification.
- Final-copy diagnostics print exact blockers for specialist-like candidates when no Full-Copy candidate exists.
- Single-token specialists remain valid when the single-specialist sample/exposure gate passes.
- Concentration is a soft risk factor and is never a specialist/execution hard blocker.
- Deep-History recovery remains bounded and never relaxes economic/timing/risk/evidence gates.
- READ-ONLY handoff only; no order is created.

Required behavior
- Full-Copy requires the complete execution/economic/evidence gates.
- VERIFIED_PARTIAL can satisfy the data-quality layer only after bounded deep verification; it never bypasses the other gates.
- Promotion cycles never substitute for Full-Copy gates.
- Exact filename must remain hyperliquid_trader_hunter.mjs.
