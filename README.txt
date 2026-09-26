Hyperliquid Meme Hunter V8.5.8
READ-ONLY / NO ORDERS

Base: V8.5.6

V8.5.8 changes:
- Preserves the Single-Token Specialist path: unique=1 is valid when Meme trades >= 60 and Meme exposure >= 50%.
- Concentration remains a soft risk factor; it is not a hard Full-Copy or Execution-Readiness blocker.
- Adds bounded Deep History Verification for incomplete specialist candidates before final ranking.
- Deep verification can inspect up to 24 fill pages by default, for up to 6 specialist candidates per cycle.
- A truncated history can become VERIFIED-PARTIAL only when there is no rate-limit/network interruption and at least 60 reconstructed closed trades are available.
- VERIFIED-PARTIAL is accepted by the data-quality layer only when all independent economic, ProfitCopy, TimingCopy, RiskCopy, evidence, sample, robustness, and readiness gates pass.
- Promotion/Research remains separate from Copy-Ready; promotion memory never relaxes Copy gates.
- Reporting distinguishes COMPLETE, VERIFIED-PARTIAL, and UNVERIFIED history.
- Execution handoff remains READ-ONLY and still requires a current Meme position, entry-distance limit, valid SL/TP/RR plan, and configured minimum RR.
- Opportunity Pool, runtime budget, checkpoints, safe-stop behavior, and handoff TTL are preserved.

Required worker filename:
hyperliquid_trader_hunter.mjs

No live orders are created by this worker.
