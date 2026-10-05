# GFTSH V2.1 — Global Futures Actual Trade Reconstruction Hunter

Exact worker filename:
`crypto_whale_signal_engine.mjs`

Scope:
- FUTURES ONLY
- READ-ONLY
- NO ORDERS
- NO AUTO-COPY

## V2.1 core correction
V2.0 treated individual Hyperliquid fills with non-zero `closedPnl` as individual trades. V2.1 does not. It reconstructs position lifecycles from fills using `startPosition`, `dir`, size and timestamps, and counts a completed lifecycle as one actual trade.

## V2.1 upgrades
- `aggregateByTime: true` to reduce partial-fill inflation.
- Paginated `userFillsByTime` retrieval, bounded to protect runtime/rate limits.
- Actual completed-trade reconstruction by coin and position direction.
- Partial reductions and adds are included in the same lifecycle instead of becoming separate trades.
- Reversal (`LONG -> SHORT` / `SHORT -> LONG`) closes the old lifecycle and starts a new one.
- PF is calculated from reconstructed trade PnL, not raw fill count.
- WR is calculated from reconstructed completed trades.
- No-loss samples are explicitly rejected from strong tiers.
- PF > 20, WR=100% without loss samples, low loss count, high fill/trade ratio and one-day PnL concentration are flagged as anomalies.
- `DDcurve` remains a reconstructed trade-PnL curve, NOT true account drawdown.
- Follow Score is separate from current-position signal gating.
- Current position verification is limited to the strongest verified candidates.
- Freshness uses the latest fill associated with the current open position.
- Discovery remains multi-venue; actionable signals require independently verified current position data.

## Signal gate
- Tier S or A
- actual completed-trade sample >= 15
- loss sample >= 3
- no quality anomaly flags
- current position exists
- latest activity <= 15 minutes
- entry distance <= 0.5%
- model SL = 0.5%
- model TP = 2R

## Required GitHub Environment secrets
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

No private exchange API keys are required.
