CRYPTO WHALE SIGNAL ENGINE V6.6

Worker:
  crypto_whale_signal_engine.mjs
  VERSION: V6.6
  BUILD_TAG: V6.6-TIERED-DISCOVERY-AUDITED-PERFORMANCE-LIFECYCLE
  DISCOVERY_SCHEMA: V6.6-TIERED-DISCOVERY-AUDITED-PERFORMANCE-LIFECYCLE

Permanent GitHub Actions workflow:
  .github/workflows/crypto-whale-signal-engine.yml

IMPORTANT:
The workflow filename and display name are intentionally version-agnostic.
Future worker versions should replace only crypto_whale_signal_engine.mjs.
The workflow extracts VERSION, BUILD_TAG and DISCOVERY_SCHEMA from the worker
and verifies that they are internally consistent. It does not hard-code a
specific worker version.

Execution remains disabled:
  EXECUTION_ENABLED=false
  DRY_RUN=true
