HYPERLIQUID MEME HUNTER V8.3

READ-ONLY specialist hunter. No orders are created by the worker.

Required worker filename:
hyperliquid_trader_hunter.mjs

V8.3 changes from V8.2:
- Keeps strict Full-Copy and execution gates unchanged.
- Promotion Track remains evidence-backed only; zero-evidence observations are excluded.
- Promotion entries now expose MemeTrades, unique Meme count, dominant/top-coin concentration, realized Meme PnL and PF.
- Promotion Gate line makes the current blockers explicit without replacing the hard execution gate.
- Execution handoff now carries a diagnostic copyPlan (entry/SL/TP/RR/ATR) for FULL-COPY-CANDIDATE entries.
- Execution Engine must still revalidate live price, distance, sizing and protective levels before any order.
- Handoff remains READ-ONLY and expires according to EXECUTION_HANDOFF_TTL_MS (worker default 10 minutes).

Do not send private keys or seed phrases to the hunter worker.
