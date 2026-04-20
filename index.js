<<<<<<< HEAD
// index.js — DataMarketplace Bot entry point
// Run from the files/ folder: npm run admin
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const logger = require('./logger');

const args    = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith('--mode='));
const mode    = modeArg ? modeArg.split('=')[1] : (process.env.BOT_MODE || 'admin');

if (mode === 'test') { require('./test'); return; }

console.log(`
╔══════════════════════════════════════════════════════╗
║  DataMarketplace Bot  v2.0  —  Sepolia               ║
║  Mode: ${mode.padEnd(46)}║
╚══════════════════════════════════════════════════════╝
`);

async function main() {
=======
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
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
  const chain = require('./chain');
  await chain.init();

  switch (mode) {
<<<<<<< HEAD
    case 'admin': {
      const { startAdminServer } = require('./admin');
      startAdminServer();
      return; // keep alive
    }

    case 'simulate':
    case 'status': {
=======

    case 'status':
    case 'simulate': {
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      const { runSimulation } = require('./simulator');
      await runSimulation();
      break;
    }

    case 'buy': {
      const { fetchAllAuctions } = require('./auctions');
      const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
      const auctions = await fetchAllAuctions();
<<<<<<< HEAD
      for (const a of auctions.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0))
        await finalizeAuction(a.address);
      const results = await bidOnEligibleAuctions(auctions.filter(a => a.isActive));
      logger.info(`Done — ${results.filter(r=>r.success).length} bids placed`);
=======

      // Finalize your ended auctions first (collect payments)
      for (const a of auctions.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0)) {
        await finalizeAuction(a.address);
      }

      const results = await bidOnEligibleAuctions(auctions.filter(a => a.isActive));
      const ok  = results.filter(r => r.success).length;
      const bad = results.filter(r => !r.success).length;
      logger.info(`Buy run complete — ${ok} bids placed, ${bad} failed`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      break;
    }

    case 'sell': {
      const { createAuctionsFromConfig } = require('./seller');
<<<<<<< HEAD
      const results = await createAuctionsFromConfig();
      logger.info(`Done — ${results.filter(r=>r.success).length}/${results.length} auctions created`);
      break;
    }

    case 'smart': {
      const { fetchAllAuctions } = require('./auctions');
      const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
      const { createAuctionsFromConfig } = require('./seller');
      const auctions = await fetchAllAuctions();
      for (const a of auctions.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0))
        await finalizeAuction(a.address);
      const createResults = await createAuctionsFromConfig();
      logger.info(`Created ${createResults.filter(r=>r.success).length} auctions`);
      const results = await bidOnEligibleAuctions(auctions.filter(a => a.isActive), 'smart');
      logger.info(`Done — ${results.filter(r=>r.success).length} bids placed`);
      break;
    }

    case 'dumb': {
      const { fetchAllAuctions } = require('./auctions');
      const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
      const { createAuctionsFromConfig } = require('./seller');
      const auctions = await fetchAllAuctions();
      for (const a of auctions.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0))
        await finalizeAuction(a.address);
      const createResults = await createAuctionsFromConfig();
      logger.info(`Created ${createResults.filter(r=>r.success).length} auctions`);
      const results = await bidOnEligibleAuctions(auctions.filter(a => a.isActive), 'dumb');
      logger.info(`Done — ${results.filter(r=>r.success).length} bids placed`);
=======
      const results = await createAuctionsFromConfig('./data/sell-list.json');
      const ok = results.filter(r => r.success).length;
      logger.info(`Sell run complete — ${ok}/${results.length} auctions created`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      break;
    }

    case 'auto': {
      const { startCron } = require('./autotrader');
      const { startListening } = require('./listener');
<<<<<<< HEAD
      await startListening();
      startCron();
      return; // keep alive
    }

    case 'winner': {
=======
      // Start WebSocket listener alongside the cron loop
      await startListening();
      startCron();
      return; // Keep running — do NOT exit
    }

    case 'winner': {
      // Check won auctions, retrieve data, export CSVs
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      const { processClosedAuctions } = require('./winner');
      await processClosedAuctions();
      break;
    }

    case 'listen': {
<<<<<<< HEAD
      const { startListening } = require('./listener');
      await startListening((addr, contributor) =>
        logger.info(`[LIVE] Bid on ${addr} by ${contributor}`)
      );
      logger.info('Listening — Ctrl+C to stop');
=======
      // Real-time event listener only (no trading)
      const { startListening } = require('./listener');
      await startListening((auctionAddress, contributor) => {
        logger.info(`[LIVE] New bid on ${auctionAddress} by ${contributor}`);
      });
      logger.info('Listening for on-chain events — press Ctrl+C to stop');
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      return; // keep alive
    }

    default:
<<<<<<< HEAD
      logger.error(`Unknown mode: "${mode}". Use: admin | simulate | buy | sell | smart | dumb | auto | winner | listen`);
=======
      logger.error(`Unknown mode: "${mode}". Use: simulate | status | buy | sell | auto | winner | listen`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
