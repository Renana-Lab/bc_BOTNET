// src/index.js — DataMarketplace Bot entry point
require('dotenv').config();
const logger = require('./logger');

const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : (process.env.BOT_MODE || 'simulate');

// Shortcut: node src/test.js or --mode=test
if (mode === 'test') {
  require('./test');
  return;
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║   DataMarketplace Bot  v2.0  —  Sepolia Testnet          ║
║   Contract: CampaignFactory (Solidity auction)           ║
║   Mode: ${mode.padEnd(50)}                               ║
╚══════════════════════════════════════════════════════════╝
`);

async function main() {
  // Initialize chain connection + wallet
  const chain = require('./chain');
  await chain.init();

  switch (mode) {

    case 'status':
    case 'simulate': {
      const { runSimulation } = require('./simulator');
      await runSimulation();
      break;
    }

    case 'buy': {
      const { fetchAllAuctions } = require('./auctions');
      const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
      const auctions = await fetchAllAuctions();

      // Finalize your ended auctions first (collect payments)
      for (const a of auctions.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0)) {
        await finalizeAuction(a.address);
      }

      const results = await bidOnEligibleAuctions(auctions.filter(a => a.isActive));
      const ok  = results.filter(r => r.success).length;
      const bad = results.filter(r => !r.success).length;
      logger.info(`Buy run complete — ${ok} bids placed, ${bad} failed`);
      break;
    }

    case 'sell': {
      const { createAuctionsFromConfig } = require('./seller');
      const results = await createAuctionsFromConfig('./data/sell-list.json');
      const ok = results.filter(r => r.success).length;
      logger.info(`Sell run complete — ${ok}/${results.length} auctions created`);
      break;
    }

    case 'auto': {
      const { startCron } = require('./autotrader');
      const { startListening } = require('./listener');
      // Start WebSocket listener alongside the cron loop
      await startListening();
      startCron();
      return; // Keep running — do NOT exit
    }

    case 'winner': {
      // Check won auctions, retrieve data, export CSVs
      const { processClosedAuctions } = require('./winner');
      await processClosedAuctions();
      break;
    }

    case 'listen': {
      // Real-time event listener only (no trading)
      const { startListening } = require('./listener');
      await startListening((auctionAddress, contributor) => {
        logger.info(`[LIVE] New bid on ${auctionAddress} by ${contributor}`);
      });
      logger.info('Listening for on-chain events — press Ctrl+C to stop');
      return; // keep alive
    }

    default:
      logger.error(`Unknown mode: "${mode}". Use: simulate | status | buy | sell | auto | winner | listen`);
      process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
