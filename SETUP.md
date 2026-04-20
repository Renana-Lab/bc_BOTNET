# DataMarketplace Bot v2.0 — Setup Guide

## Quick Start

### 1. Get Your RPC Endpoint (REQUIRED)
The bot needs access to the Ethereum blockchain. You must get your own FREE API key:

#### Option A: Infura (Recommended)
1. Go to https://www.infura.io/dash/register
2. Create a new account (free tier available)
3. Create a new "Web3 API" project for **Sepolia testnet**
4. Copy the **HTTPS** and **WebSocket** endpoints
5. Update `.env`:
   ```
   RPC_HTTP=https://sepolia.infura.io/v3/YOUR_API_KEY_HERE
   RPC_WS=wss://sepolia.infura.io/ws/v3/YOUR_API_KEY_HERE
   ```

#### Option B: Alchemy
1. Go to https://www.alchemy.com
2. Create account (free tier)
3. Create app for Sepolia
4. Copy endpoints to `.env`

#### Option C: QuickNode
1. Go to https://quicknode.com
2. Create free account
3. Create Sepolia endpoint
4. Copy endpoints to `.env`

### 2. Configure Your Wallet
Edit `.env` and set your private key:
```
PRIVATE_KEY=0x... (your MetaMask private key without 0x prefix, add it back)
```

⚠️ **NEVER share your private key!** Keep `.env` safe.

### 3. Start Admin Panel
```bash
npm run admin
```
Then open: http://localhost:3002

### 4. Verify Setup
- Click 🔧 **Diagnostics** button
- Check if factory exists
- Click 🐛 **Debug** to see available auctions

## Modes

- **Simulate**: Test bidding without sending transactions
- **Buy**: Bid on eligible auctions
- **Sell**: Create new auctions
- **Smart**: Aggressive bidding (high win rate)
- **Dumb**: Random bidding (~50% win rate)
- **Winner**: Process won auctions and refunds
- **Auto**: Run buy+sell on schedule

## Troubleshooting

### RPC Connection Failed
- **Cause**: Invalid or rate-limited API key
- **Fix**: Get your own API key from Infura/Alchemy/QuickNode
- **Time**: Takes 2-3 minutes

### No Auctions Load
- **Check**: Are auctions being returned? (🐛 Debug button)
- **If yes, 0 load**: Wrong Campaign ABI
- **If no addresses**: Wrong factory address

### Wallet Balance Shows 0
- Make sure you have testnet ETH
- Get free Sepolia ETH: https://sepoliafaucet.com

## Support

Check logs in: `logs/` folder
Watch real-time logs in admin panel → Logs tab
