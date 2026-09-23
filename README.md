# Hyperliquid Trader Hunter V5.33

Read-only meme specialist scout. No orders and no private keys.

## Exact worker filename
`hyperliquid_trader_hunter.mjs`

## V5.33 tiers
The strict specialist gate is unchanged:
- confirmed meme exposure >= 65%
- confirmed meme trades >= 12
- confirmed unique memes >= 3
- complete history required when `HYPERLIQUID_MEME_REQUIRE_COMPLETE_HISTORY=true`

A separate **Meme Focus** research tier is used to surface broader meme-focused traders without redefining strict specialists:
- exposure >= 10%
- meme trades >= 100
- unique confirmed memes >= 3
- dominant meme share <= 85%

A separate **Research Near-Miss** tier identifies complete-history traders that are closer to the strict specialist gate:
- complete history
- exposure >= 15%
- meme trades >= 100
- unique confirmed memes >= 3
- must still fail the strict specialist gate

Research Near-Miss candidates also receive the historical early-move analysis. This is historical behavior analysis only; it does not establish advance knowledge of pumps or dumps.

Unknown and probable symbols never count as confirmed memes for specialist/focus/near-miss eligibility.

## Prefilter
The fast prefilter remains capped at 30 full-history wallets. V5.33 adds Focus-oriented stratification using recent confirmed meme exposure, meme count, breadth, and concentration so broader research candidates have a route into the 30-wallet deep scan.

## GitHub
Workflow: `.github/workflows/hyperliquid-trader-hunter.yml`
Environment: `production`
Required secrets:
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional variables include:
- `HYPERLIQUID_TRADERS`
- `HYPERLIQUID_MEME_SYMBOLS`
- `HYPERLIQUID_MEME_PROBABLE_SYMBOLS`
