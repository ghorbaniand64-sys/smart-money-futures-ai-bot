# Hyperliquid Meme Execution Engine — V8 Execution

This package connects the existing READ-ONLY Meme Hunter handoff to a Hyperliquid Agent/API Wallet.

## Required GitHub Actions secrets

- `HL_MAIN_ACCOUNT_ADDRESS` = main Hyperliquid account public address
- `HL_API_WALLET_ADDRESS` = approved Agent/API Wallet public address
- `HL_API_WALLET_PRIVATE_KEY` = private key of that Agent/API Wallet only

Never commit the private key, seed phrase, or main-wallet private key.

## Runtime defaults

- `EXECUTION_ENABLED=false`
- `EXECUTION_DRY_RUN=true`
- `EXECUTION_HANDOFF_TTL_MS=600000` (10 minutes)
- source entry distance cap: 0.5%
- revalidation move cap: 0.35%
- default target notional: $10
- max notional: $25
- max account allocation: 1%
- max leverage: 3x
- minimum RR: 1.5
- maximum SL distance: 2%

## Live execution safety flow

1. Read fresh `state/meme_execution_handoff.json`.
2. Require a true `executionReady` candidate.
3. Re-check the source trader's live position and direction.
4. Re-check current order book and entry distance.
5. Read the user's account state and block duplicate positions/orders.
6. Derive and verify the Agent Wallet address from its private key.
7. Calculate position size from the user's own account value, not the source trader's size.
8. Place the entry together with TP/SL protection using Hyperliquid TP/SL grouping.
9. Require the entry to fill.
10. Verify TP and SL are present on the account.
11. If protection cannot be verified while a position remains open, fail closed.

Hyperliquid TP/SL trigger orders are supported by the exchange API; `normalTpsl` attaches fixed-size TP/SL legs to the parent order. See official Hyperliquid TP/SL documentation.

## IMPORTANT

This package is still intended to be deployed in DRY RUN first. Do not set live execution flags until the dry-run logs and a controlled test have been reviewed.
