NOVARA V2.8.6 — LEVEL PROXIMITY / EARLY ENTRY

Contents:
- novara_smart_money_ai.mjs : replace the existing main JS file in the repository.
- novara_outcome_card.py    : keep beside the JS file for graphic TP/SL outcome cards.

Core changes:
- SHORT requires price near a repeated-touch 1H resistance and a completed 15m bearish rejection.
- LONG requires price near a repeated-touch 1H support and a completed 15m bullish reclaim.
- Distance limit adapts to 1H ATR, bounded between 0.35% and 1.00%.
- New ENTRY-LOCATION diagnostics explain why a candidate is rejected.
- Maintains READ-ONLY / NO ORDERS / NO AUTO-COPY / PAPER TRACKING.
- New clean-start ID archives old paper trades so the V2.8.6 evaluation cohort is independent.

Install both files in the same folder as the current main JS file. Keep workflow and secrets unchanged.
This package passed Node.js syntax validation and Python syntax validation; a live GitHub Actions + Telegram run has not yet been verified.
