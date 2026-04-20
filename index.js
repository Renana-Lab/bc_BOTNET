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
  const chain = require('./chain');
  await chain.init();

  switch (mode) {
    case 'admin': {
      const { startAdminServer } = require('./admin');
      startAdminServer();
      return; // keep alive
    }

    case 'simulate':
    case 'status': {
      const { runSimulation } = require('./simulator');
      await runSimulation();
      break;
    }

    case 'buy': {
      const { fetchAllAuctions } = require('./auctions');
      const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
      const auctions = await fetchAllAuctions();
      for (const a of auctions.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0))
        await finalizeAuction(a.address);
      const results = await bidOnEligibleAuctions(auctions.filter(a => a.isActive));
      logger.info(`Done — ${results.filter(r=>r.success).length} bids placed`);
      break;
    }

    case 'sell': {
      const { createAuctionsFromConfig } = require('./seller');
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
      break;
    }

    case 'auto': {
      const { startCron } = require('./autotrader');
      const { startListening } = require('./listener');
      await startListening();
      startCron();
      return; // keep alive
    }

    case 'winner': {
      const { processClosedAuctions } = require('./winner');
      await processClosedAuctions();
      break;
    }

    case 'listen': {
      const { startListening } = require('./listener');
      await startListening((addr, contributor) =>
        logger.info(`[LIVE] Bid on ${addr} by ${contributor}`)
      );
      logger.info('Listening — Ctrl+C to stop');
      return; // keep alive
    }

    default:
      logger.error(`Unknown mode: "${mode}". Use: admin | simulate | buy | sell | smart | dumb | auto | winner | listen`);
      process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
