GFTSH V2.3.0 — PERSISTENT 30D GLOBAL BEHAVIOR HUNTER
READ-ONLY / NO ORDERS / NO AUTO-COPY / FUTURES ONLY

Required worker filename:
crypto_whale_signal_engine.mjs

Required workflow filename:
.github/workflows/crypto-whale-signal-engine.yml

WHAT V2.3 FIXES
1. Persistent rolling 30D behavior database is stored in:
   state/gftsh_global_behavior_v23.json
2. Verified events are deduplicated by trader/coin/side/time and retained for 30 days.
3. Behavior is accumulated across GitHub Actions cycles instead of rebuilt from only the current 40 audited traders.
4. Leaderboard discovery rotates through a bounded top universe (default 400) with a 40-trader audit chunk.
5. Persisted repeatable hunters are re-audited for fresh current-position authority before a signal can be emitted.
6. Repeatability still requires at least 2 verified events and 2 distinct coins.
7. Exit capture remains strict; strong capture >=70% is tracked separately and no quality gate is relaxed.
8. Hyperliquid remains the only current signal-grade raw trader lifecycle source in this build. Binance/Bybit are discovery-only and OKX remains source-unavailable for the required public lead-history reconstruction.

EVENT MODEL
Trader entry -> wait >=10m -> first directional trigger >=1.5% -> continuation to major move >=5% within trigger window -> MFE measured from actual entry -> exit capture >=50% -> verified event.

SIGNAL MODEL
Repeatable behavior + trader quality + copyability + source-native current position + fresh open activity + entry distance <=0.75% + model SL 0.5% + TP 2R + RR >=1.5.

TELEGRAM
Telegram contains selected signals only. Diagnostics and behavior database remain in GitHub Actions logs/state.
