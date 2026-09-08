GMX Smart Money Futures AI Bot — V17.1.1 Hybrid Structure Execution + Dynamic TP1 Stop

Core entry logic remains the V17 event-sequence engine: support/resistance, sweep/reclaim, breakout, retest, volume/range expansion, GMX smart-money flow, and Top Trader confirmation. The old weighted score is not used for entry decisions.

Execution and risk:
- EXECUTION_ENABLED defaults to true and GitHub Actions explicitly sets it to true.
- Target risk per trade: 1% of available collateral wallet balance.
- Hard execution risk cap: 1.5%.
- Maximum collateral allocation per position: 20% of wallet balance.
- Dynamic leverage: 3x–10x, selected from structural setup quality and stop distance.
- TP1/TP2/TP3 are real partial exits: 40% / 30% / 30%.
- Full-size initial stop-loss is attached at entry.
- After TP1 is actually executed and the live position is confirmed reduced to the remaining portion, a new stop-loss is created at the exact TP1 price for the remaining position. The original lower stop is cancelled when possible; if cancellation fails, the new higher stop remains active and the lower stop is retained as redundant protection.
- No arbitrary minimum trade size is imposed beyond GMX market rules.

Dynamic exit sequence:
ENTRY → initial SL + TP1/TP2/TP3 → TP1 executes (40%) → remaining position is protected at TP1 → TP2/TP3 can continue → any reversal exits the remainder at TP1 instead of returning to the original SL.

Telegram policy:
- No WATCH, RADAR, WAIT-RETEST, or EXHAUSTED notifications.
- After a verified entry: one entry message with direction, entry, collateral, notional, leverage, SL, TP1/2/3, and planned PnL.
- If a real entry setup is selected but execution is blocked: one clear ENTRY BLOCKED message with the exact reason.
- When TP1 is executed and the dynamic stop is armed: one DYNAMIC STOP message.
- After the position disappears from live GMX state, the bot reads GMX trade history before declaring the close and reports realized PnL versus planned PnL.

PnL measurement:
The planned PnL assumes the configured 40/30/30 TP distribution. Realized PnL is read from GMX trade history; the bot does not label a price-based estimate as realized PnL.

Runtime:
- Node.js 22
- @gmx-io/sdk 1.8.2
- Arbitrum / GMX V2
