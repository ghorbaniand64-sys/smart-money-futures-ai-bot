Hyperliquid Trader Hunter V6.1 — Execution Handoff Fixed

Files:
- hyperliquid_trader_hunter.mjs
- hyperliquid_execution_engine.mjs

Handoff contract:
- state/meme_execution_handoff.json
- TTL default: 600000 ms (10 minutes)
- Hunter invalidates any previous handoff at cycle start.
- Hunter writes a fresh BLOCKED handoff when no execution-ready candidate exists.
- Only executionReady=true AND copyClassification=FULL-COPY-CANDIDATE candidates are exported.
- Execution engine revalidates freshness and current source position before any order.
- HANDOFF_EXPIRED / NO_EXECUTION_HANDOFF / NO_LIVEREADY_CANDIDATE are safe blocks and return exit code 0.
- EXECUTION_ENABLED and EXECUTION_DRY_RUN behavior is unchanged; default remains no live orders.
