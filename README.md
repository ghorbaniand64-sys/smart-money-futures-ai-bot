# Hyperliquid Trader Hunter V5.32

## Worker
`hyperliquid_trader_hunter.mjs`

Read-only Hyperliquid meme-specialist research worker. No orders are created.

## V5.32 changes
- Strict specialist gate is unchanged:
  - confirmed meme exposure >= 65%
  - confirmed meme trades >= 12
  - unique confirmed meme symbols >= 3
  - complete history required
- New Meme Focus tier:
  - exposure >= 10%
  - confirmed meme trades >= 100
  - unique confirmed meme symbols >= 3
  - specialization score >= 20
  - dominant meme share <= 85%
  - complete history required
- Unknown/probable symbols never count as confirmed meme symbols.
- Focus scoring now includes breadth and dominant-meme concentration, so a trader whose meme activity is almost entirely one coin is not treated as diversified meme focus.
- Prefilter now reserves more selection capacity for focus-potential candidates instead of relying only on recent exposure/count ranking.
- Focus candidates still receive the 60-minute early-move analysis.

## GitHub Actions
Workflow:
`.github/workflows/hyperliquid-trader-hunter.yml`

Runs every 5 minutes and uses GitHub Environment `production` for Telegram secrets.
