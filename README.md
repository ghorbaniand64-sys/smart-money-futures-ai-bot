# Hyperliquid Meme Specialist Scout V5.46

READ-ONLY / NO ORDERS.

Worker filename (required): `hyperliquid_trader_hunter.mjs`

## V5.46
- Preserves Strict Multi-Meme Specialist eligibility from prior versions.
- Keeps Focus, Concentrated, Multi-Meme Research, and Near-Miss tiers separate from Strict.
- Realized closed-trade Meme PnL, WR, PF, gross profit/loss, average and median Meme trade PnL remain part of the audit.
- Execution audit now reports valid timing samples, candle-data failures, no-candle-data cases, invalid samples, and diagnostic status.
- Entry timing is explicitly separated from generic profitability.
- MFE and MAE are retained in the execution audit.
- Exit capture and post-exit continuation remain diagnostic metrics.
- Telegram is intentionally compact: wallet, tier, Meme/Total PnL, trade count, WR/PF, average/median trade PnL, Meme PnL by coin, and concise timing status.
- Detailed classifier, funnel, unknown-impact, gate, candle-audit and error diagnostics remain in the GitHub Actions run log.
- Unknown/Probable symbols never count toward Meme eligibility without explicit classification.

No orders are created by this worker.


V5.46 key correction
- HISTORY_INCOMPLETE is an eligibility/data-quality condition only. It never short-circuits Meme execution/timing analysis.
- Recent valid Meme trades are still audited for Entry Quality, Exit Quality, MFE, MAE and Behavior even when the 7d history is truncated.
- Specialist/Focus/Research eligibility remains blocked when complete history is required.
- Timing diagnostics distinguish valid samples, no-data, candle errors and invalid samples.
