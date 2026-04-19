// src/autotrader.js
// Runs buy + sell + finalize on a cron schedule.
// This is the "set it and forget it" mode.

const cron = require('node-cron');
const logger = require('./logger');
const { fetchAllAuctions, fetchMyBudget, printAuctions } = require('./auctions');
const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
const { createAuctionsFromConfig } = require('./seller');
const { getAccount, weiToEth } = require('./chain');

const stats = { runs: 0, bids: 0, finalizations: 0, auctionsCreated: 0, errors: 0 };
let isRunning = false;

async function runCycle() {
  if (isRunning) {
    logger.warn('AutoTrader: previous cycle still running — skipping overlap');
    return;
  }
  isRunning = true;
  stats.runs++;

  logger.info(`\n⚡ AutoTrader cycle #${stats.runs} — ${new Date().toISOString()}`);

  try {
    // ── 1. Fetch market state ──────────────────────────────────
    const auctions = await fetchAllAuctions();
    printAuctions(auctions);

    const myBudget = await fetchMyBudget();
    logger.info(`Budget: ${myBudget} wei (${weiToEth(myBudget)} ETH)`);

    // ── 2. Finalize ended auctions where I'm the manager ───────
    const toFinalize = auctions.filter(a =>
      !a.isActive && !a.closed && a.isManager && a.approversCount > 0
    );
    for (const a of toFinalize) {
      logger.info(`Finalizing "${a.dataDescription}" — collecting ${a.highestBid} wei`);
      try {
        await finalizeAuction(a.address);
        stats.finalizations++;
      } catch (err) {
        logger.error('Finalize failed', { address: a.address, error: err.message });
        stats.errors++;
      }
    }

    // ── 3. Bid on eligible open auctions ──────────────────────
    const openAuctions = auctions.filter(a => a.isActive);
    if (openAuctions.length > 0) {
      const bidResults = await bidOnEligibleAuctions(openAuctions);
      stats.bids += bidResults.filter(r => r.success).length;
      stats.errors += bidResults.filter(r => !r.success).length;
    }

    // ── 4. Create new auctions from sell-list.json ─────────────
    //    (only if the file exists and has items — won't re-create existing ones)
    const fs = require('fs');
    if (fs.existsSync('./data/sell-list.json')) {
      const items = JSON.parse(fs.readFileSync('./data/sell-list.json', 'utf8'));
      // Only create if file has items (guard against empty runs)
      if (items.length > 0 && process.env.AUTO_CREATE_AUCTIONS === 'true') {
        logger.info('Creating auctions from sell-list.json...');
        const created = await createAuctionsFromConfig('./data/sell-list.json');
        stats.auctionsCreated += created.filter(r => r.success).length;
      }
    }

    printStats();
  } catch (err) {
    logger.error('AutoTrader cycle error', { error: err.message, stack: err.stack });
    stats.errors++;
  } finally {
    isRunning = false;
  }
}

function startCron() {
  const schedule = process.env.AUTO_TRADE_CRON || '*/2 * * * *';
  if (!cron.validate(schedule)) {
    logger.error(`Invalid cron schedule: "${schedule}"`);
    process.exit(1);
  }
  logger.info(`⏰ AutoTrader started — cron: "${schedule}"`);
  logger.info('Press Ctrl+C to stop.\n');
  runCycle(); // run immediately on start
  cron.schedule(schedule, runCycle);
}

function printStats() {
  logger.info('📊 Session stats', stats);
}

module.exports = { startCron, runCycle };
