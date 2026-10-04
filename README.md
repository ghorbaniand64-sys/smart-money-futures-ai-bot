# GFTSH V1.9 — Global Futures Active-Trader Hunter

Read-only futures intelligence engine. No orders, no API trading keys, no auto-copy.

## Core objective
Find traders who are:
- active across many trading days
- high trade-count / high average trades per active day
- high win-rate (low observed error rate)
- positive profit factor
- controlled drawdown
- relatively short holding periods
- currently opening fresh positions when an actionable signal is emitted

## Global architecture
Discovery is global across supported public sources. A venue can remain in the global watchlist even when it cannot expose a verified public live position. Only verified live positions can become actionable signals.

## Hyperliquid verification
Hyperliquid is the current fully verified public signal source. The engine reconstructs 7D trade statistics from public fills and checks current positions before emitting a signal.

## Candidate selection
Hyperliquid audit is stratified across:
1. quality score
2. trades/day activity
3. ROI
4. PnL

This prevents the engine from repeatedly auditing only one leaderboard slice.

## Default quality gate
- 7D trades >= 40
- active days >= 5
- average trades/day >= 4
- win rate >= 58%
- profit factor >= 1.8
- median hold <= 6h
- average hold <= 12h
- max drawdown <= 30%

## Default live signal gate
- current position
- position freshness <= 15m
- entry distance <= 0.5%
- modeled RR >= 1.5

TP/SL are model levels for signal framing only; the engine does not place or modify orders.
