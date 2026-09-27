HYPERLIQUID MEME HUNTER V8.6.2-FIXED-3-LIVE

Fixed traders (rotation OFF):
- 0x64b766b07362405a9cc19c2226490f3015929da9
- 0xe639710e64d7094f7f82ab495915559c2f612953
- 0xe86b057f5eb764c9738d6b0d38170befd0723664d

Best Entry: only the strongest current position among these three is handed off.

LIVE execution settings:
- EXECUTION_ENABLED=true
- EXECUTION_DRY_RUN=false
- PAPER_EXECUTION_ONLY=false
- EXECUTION_LEVERAGE=10
- EXECUTION_ACCOUNT_ALLOCATION_PCT=50
- EXECUTION_MAX_SIMULTANEOUS_POSITIONS=2
- isolated margin mode

Execution flow:
1) Revalidate source trader position and current price.
2) Require current source-entry distance <= 0.5%.
3) Require RR >= 1.5.
4) Require no existing position in the same coin.
5) Require fewer than 2 account positions.
6) Set isolated 10x leverage for the selected asset.
7) Place an IOC entry with bounded slippage.
8) Confirm the entry is actually filled.
9) Place reduce-only market-trigger TP and SL for the actual filled size.
10) If protection placement fails, attempt an emergency reduce-only IOC close.

IMPORTANT: This build can submit real mainnet orders when the required credentials are present. Keep the account funded only with the amount intended for testing.
