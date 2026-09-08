GMX SMART MONEY STRUCTURE ENGINE V17.0.0

This is a structural rewrite of the V16 signal brain.

Decision model:
- No weighted 0-100 entry score.
- No mandatory 4H/1H/15M/5M directional agreement.
- Support/resistance zones are built from multi-timeframe swing pivots.
- A move is evaluated at the level it reaches.
- Volume expansion/drying and GMX trade-flow are read at the event.
- Support rejection/sweep + bullish response can create LONG.
- Support break does NOT short immediately; it creates WAITING_RETEST.
- Support retest + bearish rejection can create SHORT.
- Resistance rejection/sweep + bearish response can create SHORT.
- Resistance break does NOT long immediately; it creates WAITING_RETEST.
- Resistance retest + bullish hold can create LONG.
- Large moves away from levels are not chased.
- Top-trader intelligence is confirmation only and never blocks.
- Risk-based sizing and GMX market minimums remain hard safety controls.
- Live order submission is followed by explicit position verification.
- Telegram has a larger event budget and Radar uses the same structural engine.

Kept from the previous engine:
- GMX SDK v2 execution path.
- Private-key validation.
- Arbitrum RPC usage.
- USDC/USDT collateral selection.
- Risk-based sizing with no arbitrary $10 order floor.
- GMX min position/min collateral checks.
- Execution lock/deduplication.
- Live position hard-stop monitor.
- State persistence through BOT_STATE.
- Smart-money trade aggregation.
- Top-trader cohort analysis.

Intentionally removed from the decision path:
- Trend score weighting.
- 4H/1H/15M/5M confluence gate.
- Momentum/participation/structure/derivatives weighted score.
- Legacy multi-agent vote engine.
- Score-based execution threshold.
- Score-based leverage/allocation tiers.
- Separate legacy Radar score/exhaustion gate.

Deployment:
1. Replace worker_core.js with worker_core_V17_SMART_MONEY_STRUCTURE_ENGINE.js.
2. Replace github-runner.mjs with github-runner_V17.mjs.
3. Keep package.json on @gmx-io/sdk 1.8.2 and Node 22.
4. Keep GitHub Environment name `production` if secrets are stored there, and keep `environment: production` in the workflow.
5. Required secrets: ARBITRUM_RPC, GMX_PRIVATE_KEY, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID.

Important:
V17 is intentionally a new signal architecture. Do not lower a score threshold to force trades; there is no score gate to loosen. The engine waits for a structural event.
