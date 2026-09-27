Hyperliquid Meme Hunter V8.7.0-FINAL — FIXED-3 SAFE LIVE EXECUTION

This is the consolidated final build. Hunter and execution-engine versions are synchronized.

Fixed traders (rotation OFF):
1) 0x64b766b07362405a9cc19c2226490f3015929da9
2) 0xe639710e64d7094f7f82ab495915559c2f612953
3) 0xe86b057f5eb764c9738d6b0d38170befd0723664

Architecture:
- Hunter is READ-ONLY and never creates orders.
- Execution engine is separate and performs final live revalidation before any order.
- Fixed-3 selection is current-opportunity based: one best valid trade is selected, not every trader position.
- Single-token specialists are allowed; concentration is a soft risk factor, not a hard blocker.
- Historical Timing/Risk are advisory/ranking factors, not standalone execution blockers.

Current-entry hard gates:
- Trader/source entry distance <= 0.5%
- RR >= 1.5
- Valid live book and ATR/SL/TP plan
- Current Trade Quality score is informational/ranking only; it NEVER blocks a valid Fixed-3 trade
- Historical Economic/Profit/Evidence/Trades/History metrics are advisory/ranking only in Fixed-3 mode

Current Trade Quality score is informationally separated from Trader Quality. Historical trader-quality metrics never appear as hard block reasons. Only live current-entry safety gates can block: distance, RR, ATR/plan validity, non-meme position, or missing market data.

Live execution safety:
- Maximum 2 simultaneous positions
- 50% account margin allocation per position
- 10x isolated leverage
- Duplicate position/order/cloid prevention
- Source entry revalidation <=0.5% and revalidation move <=0.35%
- Minimum RR 1.5
- Real SL + TP required after fill
- Position confirmation required after protection
- Protection/confirmation failure triggers emergency close attempt
- Mainnet live execution is explicitly configured by the GitHub workflow

Workflow:
- Name: Hyperliquid Trader Monitor
- Schedule: */5 * * * *
- workflow_dispatch enabled
- Node 22
- production environment
- contents: write

Runtime dependencies:
- @nktkas/hyperliquid 0.33.3
- viem 2.56.8
- package.json is included so GitHub Actions npm install installs the Engine dependencies.

Validation performed for this build:
- node --check hyperliquid_trader_hunter.mjs
- node --check hyperliquid_execution_engine.mjs
- Execution engine self-test
- ZIP integrity test
- Workflow/version synchronization audit

No orders are created by the Hunter. The included workflow then invokes the separate live execution engine.
