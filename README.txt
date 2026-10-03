CRYPTO WHALE SIGNAL ENGINE V6.9

Worker file:
crypto_whale_signal_engine.mjs

Replace ONLY the Worker file in the repository.
Do NOT replace or rename the permanent workflow.

V6.9 changes:
- Partial historical data is explicitly separated from unavailable history.
- Available observed PnL/fills are surfaced instead of appearing as zero/empty performance.
- WR/PF/ROI remain withheld when there is no closed-trade sample; no fake metrics are manufactured.
- Partial history remains ineligible for the Verified gate.
- Stale cached history is labeled as observed partial history, not zero performance.
- Existing discovery, Active Watch, lifecycle, signal, RR, SL/TP and rate-limit-safe behavior is preserved.
- READ-ONLY / SIGNALS ONLY / NO ORDERS.

Validation:
node --check crypto_whale_signal_engine.mjs
WHALE_SELF_TEST=true node crypto_whale_signal_engine.mjs
