# Hyperliquid Trader Hunter V5.38

READ-ONLY / NO ORDERS.

## Worker
- Required filename: `hyperliquid_trader_hunter.mjs`

## V5.38 changes
- Keeps the V5.36 strict specialist gate unchanged: confirmed meme symbols + exposure >= 65% + meme trades >= 12 + unique memes >= 3, with complete-history requirements preserved.
- Makes Near-Miss strict shortfalls explicit, including the actual value and threshold (for example `EXPOSURE 18.4% < 65%`).
- Removes ambiguous `memeTrades=242/12` formatting; reports actual meme-trade count with its minimum separately.
- Fixes duplicated percent formatting in Unknown Impact output (`22.6%%` -> `22.6%`).
- Keeps Unknown/Probable symbols diagnostic only; they are never promoted to confirmed memes by simulation.
- Keeps Focus and Research as separate diagnostic tiers and does not redefine Strict Specialists.
- No order execution is added.


## V5.38 diagnostic changes
- Keeps strict specialist gate unchanged: exposure >=65%, meme trades >=12, unique memes >=3, complete history.
- Adds explicit strict-gate deficit wording in TOP NEAR-MISSES.
- Adds STRICT EXPOSURE GAP diagnostic buckets: 0–10pp, 10–25pp, 25–40pp, 40pp+.
- Fixes percentage formatting in research output.
- Keeps Unknown/Probable diagnostic-only behavior and Focus/Research tiers unchanged.
- READ-ONLY / NO ORDERS.
