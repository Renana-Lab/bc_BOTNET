const cron = require('node-cron');
const logger = require('./logger');
const { fetchAllAuctions, fetchMyBudget, printAuctions } = require('./auctions');
const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
const { maintainAuctionInventory } = require('./seller');
const { startListening } = require('./listener');
const { weiToEth, unwrapError } = require('./chain');

const stats = { runs: 0, bids: 0, finalized: 0, created: 0, errors: 0 };
let isRunning = false;
let listenerReady = false;
let liveTriggerTimer = null;

async function runCycle() {
  if (isRunning) {
    logger.warn('Cycle already running - skipping overlap');
    return;
  }

  isRunning = true;
  stats.runs++;
  logger.info(`Cycle #${stats.runs} - ${new Date().toISOString()}`);

  try {
    const auctions = await fetchAllAuctions();
    printAuctions(auctions);

    const myBudget = await fetchMyBudget();
    logger.info(`Budget: ${myBudget} wei (${weiToEth(myBudget)} ETH)`);

    if (process.env.ENABLE_FINALIZE !== 'false') {
      for (const auction of auctions.filter((a) => !a.isActive && !a.closed && a.isManager && a.approversCount > 0)) {
        try {
          const result = await finalizeAuction(auction.address);
          if (!result?.skipped) stats.finalized++;
        } catch (err) {
          logger.error(`Finalize failed for ${auction.address}`, { error: err.message });
          stats.errors++;
        }
      }
    }

    if (process.env.ENABLE_SELLING === 'true') {
      const created = await maintainAuctionInventory(auctions);
      stats.created += created.filter((r) => r.success).length;
      stats.errors += created.filter((r) => !r.success).length;
    }

    if (process.env.ENABLE_BIDDING !== 'false') {
      const results = await bidOnEligibleAuctions(auctions.filter((a) => a.isActive));
      stats.bids += results.filter((r) => r.success && !r.simulated).length;
      stats.errors += results.filter((r) => !r.success).length;
    }

    logger.info('Session stats', stats);
  } catch (err) {
    logger.error('Cycle error', { error: unwrapError(err) });
    stats.errors++;
  } finally {
    isRunning = false;
  }
}

function startCron() {
  const schedule = process.env.AUTO_TRADE_CRON || '*/2 * * * *';
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: ${schedule}`);
  }

  logger.info(`AutoTrader cron: "${schedule}"`);
  ensureListener();
  runCycle();
  cron.schedule(schedule, runCycle);
}

async function ensureListener() {
  if (listenerReady) return;
  listenerReady = true;
  try {
    await startListening(() => {
      clearTimeout(liveTriggerTimer);
      liveTriggerTimer = setTimeout(() => {
        runCycle().catch((err) => logger.error('Live-triggered cycle failed', { error: unwrapError(err) }));
      }, 1500);
    });
  } catch (err) {
    logger.warn('Live listener could not start', { error: err.message });
  }
}

module.exports = { runCycle, startCron };
