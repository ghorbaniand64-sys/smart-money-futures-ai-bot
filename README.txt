GFTSH V2.2.1 — GLOBAL BEHAVIOR EVENT RECON FIXED

Worker: crypto_whale_signal_engine.mjs
Workflow: .github/workflows/crypto-whale-signal-engine.yml
Mode: READ-ONLY / SIGNAL-ONLY / NO ORDERS / NO AUTO-COPY

This build fixes the V2.2 behavior-hunt logic. Hyperliquid historical closed trades are no longer treated as if the time-to-MFE were the trader's pre-pump lead. The engine now requests 5m candles around each candidate lifecycle, detects the FIRST market move that reaches the configured pump/dump threshold after the trader is already positioned, measures trader lead time to that event start, measures event MFE and exit capture, and promotes a hunter only when the behavior repeats across multiple independent events and at least two distinct coins.

Global hunt remains evidence-first:
- Hyperliquid: behavior + current-position signal source.
- OKX: public lead-trading source is isolated unless the current public API exposes enough trader-history evidence; no fabricated signal.
- Binance / Bybit: discovery-only until raw public trader-history/current-position evidence is sufficient.

Default behavior requirements:
- 30-day performance/event lookback
- pump/dump threshold: 8%
- minimum pre-event lead: 10m
- exit capture: >=50% of event MFE
- minimum repeated events: 2
- minimum distinct coins: 2
- behavior score: >=70
- final signal still requires existing strict trader-quality, copyability, live-position, freshness, entry-distance and RR gates.

Telegram is signal-only. Diagnostics, event observations, near misses and source availability remain in the GitHub Actions log/state.
