HYPERLIQUID MEME HUNTER V8

Purpose:
- Read-only Meme trader discovery and promotion tracking.
- No orders are created by the Hunter.
- Full-Copy and execution gates remain strict.

V8 upgrades:
1. Persistent cycle-to-cycle promotion memory:
   state/meme_hunter_memory.json
2. Promotion Track separates repeated high-quality research candidates from final Copy candidates.
3. Promotion score uses economic edge, ProfitCopy, TimingCopy, RiskCopy, evidence, readiness and repeated-cycle stability.
4. Promotion memory never relaxes any Full-Copy gate.
5. Fresh execution handoff:
   state/meme_execution_handoff.json
   TTL default 600000 ms (10 minutes).
6. Old handoff is invalidated at Hunter cycle start.
7. Only executionReady=true AND FULL-COPY-CANDIDATE traders are eligible for handoff.
8. Telegram now separates FINAL COPY CANDIDATES from PROMOTION TRACK / RESEARCH.
9. Execution Engine V8 treats missing/expired/no-ready handoffs as safe blocks (exit 0), while real execution errors remain nonzero.

Required worker filename:
hyperliquid_trader_hunter.mjs

Execution Engine filename:
hyperliquid_execution_engine.mjs

Default live execution remains unchanged: no live order unless the external execution flags explicitly enable it and all execution safety checks pass.

Validation:
- node --check passed for both JavaScript files.
- Full runtime was not claimed because the build environment does not contain @nktkas/hyperliquid.
