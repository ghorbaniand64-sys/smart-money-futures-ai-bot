# Hyperliquid Trader Hunter V5.31

Read-only meme specialist scout. No orders and no private keys.

## Exact worker filename
`hyperliquid_trader_hunter.mjs`

## V5.31 change
The strict specialist gate is preserved:
- confirmed meme exposure >= 65%
- confirmed meme trades >= 12
- confirmed unique memes >= 3
- complete history required

A separate **Meme Focus Candidate** tier was added so the system does not become empty when no trader meets the strict specialist definition:
- exposure >= 20%
- meme trades >= 12
- unique confirmed memes >= 2

Focus candidates receive early-move analysis and a separate focus score. They do not count as strict specialists and do not weaken the strict gate.

If no strict specialist exists, the watchlist export falls back to the top focus candidates so the next `watch` cycle can monitor useful research candidates.

## GitHub
Workflow: `.github/workflows/hyperliquid-trader-hunter.yml`
Environment: `production`
Required environment secrets:
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional repository/environment variables:
- `HYPERLIQUID_TRADERS`
- `HYPERLIQUID_MEME_SYMBOLS`
- `HYPERLIQUID_MEME_PROBABLE_SYMBOLS`
