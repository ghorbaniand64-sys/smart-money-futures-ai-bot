# Hyperliquid Meme Trader Hunter V6.1.0

READ-ONLY / NO ORDERS.

## Purpose
V6 is a discovery-first rewrite of the V5.53 research architecture. It is designed to improve recall before applying strict copyability gates. It does **not** place orders and does not contain private keys.

## Major architecture
- Broader leaderboard universe with a deterministic long-tail discovery lane.
- Five rotating coverage slots so the research universe is not limited to one cycle.
- Closed-lifecycle Meme prefilter instead of raw-fill-only activity scoring.
- Economic discovery lane: realized Meme PnL, PF, mean/median PnL, bootstrap stability and trade-PnL concentration influence prefilter selection.
- Activity, exposure, breadth, raw-fill and recency lanes remain separate.
- Deterministic blind recall lane prevents a single scoring model from eliminating the same addresses every cycle.
- Full audit sample increased to 60 recent closed Meme trades by default.
- History verification can use up to 12 fill pages by default; truncation remains visible and blocks Full-Copy/LiveReady when required.
- Bootstrap resampling (300 deterministic resamples by default) estimates stability of mean PnL and positive-trade rate. It is an evidence indicator, not statistical proof.
- Trade-level PnL concentration is measured separately from coin concentration.
- Economic Edge now considers bootstrap lower-mean stability and trade concentration, not only PF/WR.
- ProfitCopy incorporates independent economic stability signals.
- Evidence/Risk dimensions include bootstrap and trade concentration.
- Timing remains historical execution analysis; it is never treated as evidence of advance knowledge.
- Unknown/probable symbols never count as confirmed Meme trades.
- Strict Specialist criteria are preserved; V6 does not lower them to manufacture candidates.
- LiveReady remains a safety gate only. This worker never submits orders.

## Default research shape
- Leaderboard candidate universe: 750 addresses from a broader discovery pool.
- Rotating coverage: 5 slots.
- Per-cycle scan: 180 addresses.
- Full-history prefilter target: 40 addresses.
- Timing/audit sample: up to 60 closed Meme trades.
- Bootstrap: 300 deterministic resamples.

These are defaults and can be overridden with environment variables.

## Exact worker filename
`hyperliquid_trader_hunter.mjs`

The filename must remain unchanged for the GitHub runner.

## Safety
- READ-ONLY.
- NO ORDERS.
- NO PRIVATE KEYS.
- Do not set any execution flag in this worker.
- The existing execution engine should remain disabled until a V6 candidate passes research validation and its separate dry-run order/SL/TP/RR path has been audited.

## What to look for in Telegram
V6 should expose:
- discovery universe and rotating coverage
- prefilter economic-qualified and recall/blind lanes
- history completeness
- Meme classification coverage and unknown impact
- Meme PnL / PF / mean / median
- Bootstrap score and bootstrap lower-mean PnL
- trade-PnL concentration
- temporal stability
- ProfitCopy / TimingCopy / RiskCopy
- independent Data/Profit/Timing/Risk evidence
- exact LiveReady block reasons

A `Strict: 0` result is no longer treated as sufficient evidence that no good trader exists. The report must show the discovery funnel and research candidates so false negatives can be diagnosed.


## V6.1 — Persistent Candidate Memory / Promotion Engine

This version completes the final research architecture layer without changing the strict Meme Specialist thresholds. It persists a bounded candidate memory at `state/meme_hunter_memory.json` and recalls high-value addresses across rotating discovery cycles.

### Memory stages
- `OBSERVED`: seen with Meme activity but not enough evidence for tracking.
- `TRACKED`: positive/evidential candidate worth retaining.
- `SAMPLE_BUILDING`: positive economics with enough evidence to deliberately grow the sample.
- `PROMOTION_READY`: strong economic + profit + timing + risk evidence, complete history, and concentration within the promotion ceiling.
- `EXECUTION_CANDIDATE`: the existing LiveReady gate passed. This does not place an order.
- `DEMOTED`: repeated weak economic/risk evidence; automatically cooled down from recall.

Memory is a recall mechanism, not a replacement for the current-cycle gates. Every recalled address is re-audited from fresh Hyperliquid data. It cannot bypass history completeness, Meme classification, concentration, timing, risk, economic, or LiveReady gates.

Persistence is intentionally bounded: at most 250 addresses and 30 days. GitHub Actions persists the state file only on the hourly persistence window or a material promotion/demotion stage change, avoiding a commit every five minutes.

The worker remains READ-ONLY and contains no private keys or order submission.
