HYPERLIQUID MEME HUNTER V8.5
READ-ONLY | NO ORDERS

Worker: hyperliquid_trader_hunter.mjs

V8.5 fixes Promotion/Research candidate loss by sourcing promotion from the
complete analyzed set plus the retained near-miss safety pool. Strict specialists
are excluded from the Promotion display to avoid duplicates, but execution gates
are unchanged. The compact report exposes promotion diagnostics (analyzed,
source, evidence-backed, strict-excluded) so a zero list is diagnosable.

Run syntax checks before deployment. No live order is created by the hunter.
