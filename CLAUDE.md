# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bc_BOTNET** is an automated bidding/selling bot for a data marketplace auction platform. It interacts directly with Solidity smart contracts (`CampaignFactory` and `Campaign`) on the Sepolia testnet via Web3.js — no browser automation.

## Commands

```bash
npm run simulate   # Read-only dry-run: shows decisions, sends no transactions
npm run buy        # Bid on open auctions matching configured criteria
npm run sell       # Create new auction listings from data/sell-list.json
npm run auto       # Cron-based loop: finalize → bid → sell (runs forever)
npm run status     # Snapshot of all auctions + wallet state
npm run winner     # Process closed auctions: retrieve won data, export CSVs
npm run listen     # Real-time WebSocket event listener (no trading)
npm run test       # Unit tests for shouldBid() logic (no RPC calls)
```

Mode can also be set via `--mode=<mode>` CLI flag or `BOT_MODE` env var.

## Architecture

All blockchain modules import from `chain.js`, which is the single source of truth for the Web3 instance, wallet account, and factory contract. Every mode calls `chain.init()` first.

| File | Role |
|------|------|
| `index.js` | CLI entry point — parses mode, routes to module |
| `chain.js` | Web3 + wallet + contract initialization |
| `auctions.js` | Fetches all campaigns from factory; enriches with on-chain state |
| `bidder.js` | Bidding strategy (`shouldBid()`), `contribute()` calls, finalization |
| `seller.js` | Creates listings via `createCampaign()`; reads `data/sell-list.json` |
| `simulator.js` | Identical logic path to live mode but skips all `send()` calls |
| `autotrader.js` | Cron scheduler (default every 2 min) running full trade cycle |
| `listener.js` | WebSocket subscriber for `AuctionCreated`, `BidAdded`, etc. |
| `winner.js` | Retrieves won auction data via `getData()`, exports CSV history |
| `logger.js` | Winston logger → console (colored) + `logs/bot.log` / `logs/error.log` |
| `test.js` | Pure-function unit tests; mocks `chain.js` |

## Environment Setup

Create a `.env` file with:

```env
PRIVATE_KEY=0x...
RPC_HTTP=https://sepolia.infura.io/v3/<key>
RPC_WS=wss://sepolia.infura.io/ws/v3/<key>
CHAIN_ID=11155111
FACTORY_ADDRESS=0x...
FACTORY_SOCKET_ADDRESS=0x...
BOT_MODE=simulate

# Bidding strategy
MAX_BID_WEI=5000
OUTBID_BY_WEI=100
MAX_MIN_CONTRIBUTION_WEI=2000
SKIP_IF_WINNING=true
MIN_TIME_REMAINING_SEC=60

# Auto mode
AUTO_TRADE_CRON=*/2 * * * *
LOG_LEVEL=info
```

## Required Files Not in Repo

- `abis/Campaign.json` and `abis/CampaignFactory.json` — must be copied from Solidity build output before the bot can run.
- `data/sell-list.json` — must be created manually; used by `sell` mode to define auction listings.

## Bidding Strategy

`shouldBid()` in `bidder.js` evaluates each auction in order:
1. Auction is open and has `> MIN_TIME_REMAINING_SEC` remaining
2. Caller is not the auction manager (seller)
3. If `SKIP_IF_WINNING=true`, skip if already winning
4. Auction's minimum contribution ≤ `MAX_MIN_CONTRIBUTION_WEI`
5. Bid amount = `highestBid + OUTBID_BY_WEI` (or `minimumContribution` if no bids yet)
6. Since the contract accumulates contributions, only the **delta** above your existing bid is sent
7. Final amount must be ≤ `MAX_BID_WEI` and within available on-chain budget

All transactions use a 20% gas buffer (`Math.ceil(estimatedGas * 1.2)`).

## Workflow: Commit and Push After Every Change

After completing any code change, always:
1. `git add` the modified files
2. `git commit -m "<type>: <concise description>"` — use conventional commit style (e.g. `fix:`, `feat:`, `refactor:`, `chore:`)
3. `git push` to GitHub

Do this automatically without waiting to be asked.

## Contract Methods Called

**CampaignFactory:** `getDeployedCampaigns()`, `createCampaign()`, `getBudget()`

**Campaign (per auction):** `getSummary()`, `getStatus()`, `getBid()`, `contribute()` (payable), `finalizeAuctionIfNeeded()`, `getData()`, `getTransactions()`
