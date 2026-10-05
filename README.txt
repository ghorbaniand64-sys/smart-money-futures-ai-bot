GFTSH V2.1.10 — STRATEGY-AWARE QUALITY & COPYABILITY

READ-ONLY / NO ORDERS / NO AUTO-COPY / FUTURES ONLY

Worker: crypto_whale_signal_engine.mjs
Workflow: .github/workflows/crypto-whale-signal-engine.yml
Environment: production
Schedule: */5 * * * * + workflow_dispatch

V2.1.10 keeps V2.1.9 actual-trade reconstruction, current-position authority and entry validation, then adds two quality paths:

1) HIGH-WR CLASSIC
   Existing strict gate remains:
   trades >= 8, WR >= 58%, PF >= 1.8, positive realized PnL, DD <= 25%.

2) ASYMMETRIC PROFIT SPECIALIST
   Allows low-WR strategies only when all of these hold:
   trades >= 20
   PF >= 2.0
   DD <= 20%
   recovery factor >= 2
   positive realized PnL
   top-1 profit concentration <= 40%
   top-3 profit concentration <= 70%
   recent 24H PF >= 1.25
   recent 24H PnL > 0
   no material recent PF drift

COPYABILITY HARD GATE:
   max live position concentration <= 20%
   max coin concentration <= 20%
   max leverage <= 40x

A trader must pass either HIGH-WR or ASYMMETRIC and the independent COPYABILITY gate.
No threshold is relaxed merely to manufacture signals.

Current position authority remains Hyperliquid clearinghouseState only.
Freshness remains real fill time <= 15 minutes.
Entry distance remains <= 0.75%; model SL 0.5%; TP 2R; RR >= 1.5.
PF unavailable remains distinct from low PF.

The report explicitly shows STRATEGY GATE and COPY GATE diagnostics.
