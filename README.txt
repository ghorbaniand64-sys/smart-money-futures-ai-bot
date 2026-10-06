GFTSH V2.2.2 — GLOBAL BEHAVIOR EVENT RECON
READ-ONLY / NO ORDERS / NO AUTO-COPY / FUTURES ONLY

Worker filename (required): crypto_whale_signal_engine.mjs
Workflow filename (required): .github/workflows/crypto-whale-signal-engine.yml

V2.2.2 fixes the V2.2.1 event detector:
- Major move threshold defaults to 5% (configurable).
- A 1.5% directional trigger is detected first.
- The trader must enter at least 10 minutes before the trigger.
- The trigger must develop into the major 5% move inside the event window.
- Exit capture is measured against MFE from the actual trader entry.
- Behavior events are grouped by trader across independent coins.
- No behavior signal is promoted from a single event.
- Binance/Bybit remain discovery-only without raw public trader lifecycle data.
- OKX remains source-unavailable for the required public lead-history reconstruction.
- Telegram remains signal-only.

Important: this version does not relax the final trader quality/copyability/current-position gates.
