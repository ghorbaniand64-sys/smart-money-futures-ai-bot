GFTSH V2.2 — GLOBAL BEHAVIOR HUNTER
====================================

Mode
----
READ-ONLY / NO ORDERS / NO AUTO-COPY.

Goal
----
Find repeatable traders who repeatedly enter before large crypto moves and exit near the end of those moves, then follow only verified current entries.

This is a behavior hunter, not a Hyperliquid-only leaderboard hunter.

Global sources
--------------
1. Hyperliquid: full public fills + clearinghouseState. Used for behavior history and live signal validation.
2. OKX: official public copy-trading lead rankings, public current lead positions and public closed lead-position history. OKX current lead-position data is documented as delayed, so freshness is adjusted conservatively.
3. Binance: discovery-only in V2.2. Binance exposes public Futures Copy Trading / Smart Money trader information, but V2.2 does not fabricate raw trader-level historical fills where an official public feed is not available.
4. Bybit: discovery-only in V2.2. Public master-trader ranking is useful for discovery, but V2.2 does not promote a trader to a signal without independently verifiable trader-level history/position data.

Behavior model
--------------
A candidate event is a closed trade that:
- begins at least GLOBAL_MIN_PREPUMP_LEAD_MIN before the move completes;
- produces a large realized directional move (default 8%);
- completes within the configured event horizon (default 12h);
- demonstrates strong exit capture where exchange candles are available;
- repeats at least twice in the 30-day behavior window.

No single lucky trade can promote a trader.

Quality gates
-------------
The original V2.1 strategy-aware quality and copyability gates remain strict.
No threshold is relaxed to manufacture signals.

Telegram
--------
Telegram is intentionally SIGNAL-ONLY.
Diagnostics, source health, quality evidence, near-misses, global discovery counts, API failures and forensic detail stay in GitHub Actions logs/state.
If there is no selected verified signal, V2.2 sends no Telegram message.

Selected signal requirements
----------------------------
- repeatable behavior profile
- current position verified from source-native current-position data
- fresh entry <= 15 minutes after source delay adjustment
- entry distance <= 0.75%
- model SL 0.5%
- model TP 2R
- RR >= 1.5
- quality gate passed
- copyability gate passed

Files
-----
Worker: crypto_whale_signal_engine.mjs
Workflow: .github/workflows/crypto-whale-signal-engine.yml
State: state/gftsh_v2_2_state.json

Secrets in GitHub Environment: production
------------------------------------------
TELEGRAM_TOKEN = Telegram bot token
TELEGRAM_CHAT_ID = Telegram destination chat ID
HYPERLIQUID_API_URL = optional; default https://api.hyperliquid.xyz/info
HL_LEADERBOARD_URL = optional; default Hyperliquid public leaderboard

No OKX credentials are required for the public V2.2 OKX endpoints.
