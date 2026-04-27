require('dotenv').config({ path: require('./paths').envPath });
const logger = require('./config/logger');
const { installProcessGuards } = require('./config/process-guards');

installProcessGuards();

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : (process.env.BOT_MODE || 'admin');

if (mode === 'test') {
  require('../test/bidder.test');
  return;
}

async function main() {
  const chain = require('./chain');
  await chain.init();

  switch (mode) {
    case 'admin': {
      const { startAdminServer } = require('./admin/server');
      startAdminServer();
      return;
    }
    case 'simulate':
    case 'status': {
      const { runSimulation } = require('./runtime/simulator');
      await runSimulation();
      break;
    }
    case 'buy': {
      const { fetchAllAuctions } = require('./market/auctions');
      const { bidOnEligibleAuctions, finalizeAuction } = require('./market/bidder');
      const auctions = await fetchAllAuctions();
      for (const auction of auctions.filter((a) => !a.isActive && !a.closed && a.isManager && a.approversCount > 0)) {
        await finalizeAuction(auction.address);
      }
      const results = await bidOnEligibleAuctions(auctions.filter((a) => a.isActive));
      logger.info(`Buy run complete - ${results.filter((r) => r.success).length} bids placed`);
      break;
    }
    case 'sell': {
      const { createAuctionsFromConfig } = require('./market/seller');
      const results = await createAuctionsFromConfig();
      logger.info(`Sell run complete - ${results.filter((r) => r.success).length}/${results.length} auctions created`);
      break;
    }
    case 'smart':
    case 'dumb': {
      const { fetchAllAuctions } = require('./market/auctions');
      const { bidOnEligibleAuctions, finalizeAuction } = require('./market/bidder');
      const { createAuctionsFromConfig } = require('./market/seller');
      const auctions = await fetchAllAuctions();
      for (const auction of auctions.filter((a) => !a.isActive && !a.closed && a.isManager && a.approversCount > 0)) {
        await finalizeAuction(auction.address);
      }
      if (process.env.ENABLE_SELLING === 'true') {
        await createAuctionsFromConfig();
      }
      const results = await bidOnEligibleAuctions(auctions.filter((a) => a.isActive), mode);
      logger.info(`${mode} run complete - ${results.filter((r) => r.success).length} bids placed`);
      break;
    }
    case 'auto': {
      const { startCron } = require('./runtime/autotrader');
      const { startListening } = require('./runtime/listener');
      await startListening();
      startCron();
      return;
    }
    case 'winner': {
      const { processClosedAuctions } = require('./market/winner');
      await processClosedAuctions();
      break;
    }
    case 'listen': {
      const { startListening } = require('./runtime/listener');
      await startListening((address, contributor) => {
        logger.info(`[LIVE] Bid on ${address} by ${contributor}`);
      });
      return;
    }
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }

  process.exit(0);
}

main().catch((err) => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
