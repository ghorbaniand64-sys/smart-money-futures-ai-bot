GFTSH V2.1.8 — COMPLETE EVIDENCE AUDIT

Worker filename (EXACT):
crypto_whale_signal_engine.mjs

Workflow filename (EXACT):
.github/workflows/crypto-whale-signal-engine.yml

Mode:
READ-ONLY | NO ORDERS | NO AUTO-COPY | FUTURES ONLY

Source authority:
Hyperliquid public leaderboard + public user fills + clearinghouseState + allMids.
Current position authority is clearinghouseState ONLY.

V2.1.8 adds:
- Complete quality evidence matrix with Trades / WR / PF / DD / PnL.
- Exact quality failure combinations per live candidate.
- Near-miss report for traders that pass live-position + entry validation but fail historical quality.
- Separate live-position, live-match and entry-ready counts.
- Expanded lifecycle metrics: active days, recent closed trades, average/median hold and trades/day in persisted state.
- Richer persisted state with top evidence and near-miss candidates.
- Preserves strict quality thresholds; no gate is relaxed to manufacture signals.
- Preserves activity-first audit and rate-limit protection.
- Preserves real freshness <=15m and real current-position verification.
- Preserves entry <=0.75%, model SL 0.5%, TP 2R, RR >=1.5.
- MAX_SIGNALS remains 5.

Production GitHub environment:
production

Required secrets:
TELEGRAM_TOKEN
TELEGRAM_CHAT_ID

Optional secrets:
HYPERLIQUID_API_URL (default: https://api.hyperliquid.xyz/info)
HL_LEADERBOARD_URL (default: https://stats-data.hyperliquid.xyz/Mainnet/leaderboard)

Default runtime limits in workflow:
Discovery leaderboard: 250 source rows considered
Audit ranked pool: 60
Activity audit: 40
Concurrency: 2
Minimum request gap: 350ms
Global 429 cooldown: 5000ms
Performance lookback: 168h / 7d
Max fill pages: 8

Quality gates in workflow:
Closed trades >= 8
WR >= 60%
PF >= 1.35
DD <= 25%

Signal gates in workflow:
Freshness <= 15m
Entry distance <= 0.75%
Model SL = 0.5%
TP = 2R
RR >= 1.5
Minimum signal notional = $100

Validation performed before packaging:
- node --check PASS
- deterministic mocked runtime PASS
- actionable signal path PASS
- quality evidence matrix PASS
- near-miss/state schema PASS
- ZIP integrity PASS

No live Hyperliquid trading or order execution is performed by this package.
