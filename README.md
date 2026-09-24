# Hyperliquid Meme Specialist Scout V5.45

READ-ONLY / NO ORDERS.

Worker filename (required): `hyperliquid_trader_hunter.mjs`

## V5.45
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
