Hyperliquid Meme Hunter V8.5.6
READ-ONLY / NO ORDERS

Base: V8.5.5

V8.5.6 changes:
- Single-Token Specialist path added: a trader can qualify with unique=1 when Meme trades >= 60 and Meme exposure >= 50%.
- Multi-Meme Specialist path remains unchanged: Meme trades >= 12, exposure >= 65%, unique Meme coins >= 3.
- Concentration is no longer a hard Full-Copy or Execution-Readiness blocker. It remains a soft risk/robustness factor.
- Full-Copy safety gates remain strict: positive realized Meme economics, PF, sample depth, timing coverage, robustness, ProfitCopy, TimingCopy, RiskCopy, evidence, and complete history.
- Execution handoff now additionally requires the live position to be a Meme position, current entry distance <= configured max, and a finite SL/TP/RR plan with RR >= configured minimum.
- Specialist type is recorded as SINGLE-TOKEN or MULTI-MEME for downstream execution/reporting.
- Opportunity Pool, runtime budget, checkpoints, safe-stop behavior, and handoff TTL from V8.5.5 are preserved.

Required worker filename:
hyperliquid_trader_hunter.mjs

No live orders are created by this worker.
