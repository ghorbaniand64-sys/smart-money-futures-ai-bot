# Hyperliquid Trader Hunter V5.51

READ-ONLY / NO ORDERS.

## V5.51 focus
V5.51 separates **sample/evidence strength** from ProfitCopy, TimingCopy and RiskCopy.

### Key rules
- Strict Meme Specialist eligibility is unchanged.
- Timing/Behavior audit still runs on incomplete history.
- `FULL-COPY-CANDIDATE` requires:
  - positive realized Meme PnL
  - PF >= configured minimum
  - positive median Meme trade PnL
  - minimum full-copy sample (default 60 Meme trades)
  - timing sample/coverage requirements
  - concentration/risk/robustness requirements
  - ProfitCopy, TimingCopy and RiskCopy minimums
  - Evidence Strength minimum
  - complete history by default
- `FULL-COPY-PROVISIONAL` can appear only when the score/evidence requirements are met but history is incomplete.
- `PROFIT-COPYABLE` requires a full sample (default 60), positive realized Meme PnL, and sufficient Profit/Risk dimensions.
- A positive result with fewer than 30 Meme trades is explicitly `PROFIT-INSUFFICIENT-SAMPLE` rather than being promoted as copyable.
- `Evidence Strength` is an audit-strength indicator, **not statistical confidence**.
- Unknown and Probable symbols never count toward confirmed Meme eligibility.
- No orders are created by this worker.

Worker filename must remain exactly:
`hyperliquid_trader_hunter.mjs`
