Hyperliquid Meme Hunter V8.1
READ-ONLY / NO ORDERS

Exact worker filename:
hyperliquid_trader_hunter.mjs

V8.1 changes:
- Keeps all Full-Copy / execution gates hard; promotion never relaxes them.
- Persists promotion records correctly into state/meme_hunter_memory.json.
- Adds explicit NEXT actions to the Telegram Promotion Track, derived from actual block reasons.
- Adds cycle-to-cycle score delta so repeated evidence is visible (baseline/stable or Econ/Timing/Risk/Ready changes).
- Keeps promotion labels NEW -> WATCH -> PROMOTION-READY based on repeated evidence and hard criteria.
- Fresh execution handoff remains TTL 600000 ms and only receives execution-ready candidates.
- RUNNING/empty handoff is written at cycle start so stale handoffs cannot be consumed.
- Execution engine remains read-only by default / dry-run protected.

Examples of NEXT output:
NEXT: COMPLETE_HISTORY + CONCENTRATION≤85%
NEXT: TRADES≥30 + TIMING≥65
NEXT: REPEAT_CYCLES≥2

No live order is created by the hunter.
