// autotrader.js — cron-based trading loop
const cron = require('node-cron');
const logger = require('./logger');
const { fetchAllAuctions, printAuctions } = require('./auctions');
const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
const { createAuctionsFromConfig } = require('./seller');
const { weiToEth, unwrapError } = require('./chain');
const { fetchMyBudget } = require('./auctions');

const stats = { runs: 0, bids: 0, finalized: 0, created: 0, errors: 0 };
let isRunning = false;

async function runCycle() {
  if (isRunning) { logger.warn('Cycle already running — skipping'); return; }
  isRunning = true;
  stats.runs++;
  logger.info(`\n⚡ Cycle #${stats.runs} — ${new Date().toISOString()}`);

  try {
    const auctions  = await fetchAllAuctions();
    printAuctions(auctions);

    const myBudget  = await fetchMyBudget();
    logger.info(`Budget: ${myBudget} wei (${weiToEth(myBudget)} ETH)`);

    // Finalize ended auctions where we are manager
    for (const a of auctions.filter(a => !a.isActive && !a.closed && a.isManager && a.approversCount > 0)) {
      try { await finalizeAuction(a.address); stats.finalized++; }
      catch (_) { stats.errors++; }
    }

    // Auto-create if no open auctions
    if (process.env.AUTO_CREATE_AUCTIONS === 'true' && auctions.filter(a => a.isActive).length === 0) {
      logger.info('No open auctions — auto-creating from sell-list.json...');
      const created = await createAuctionsFromConfig();
      stats.created += created.filter(r => r.success).length;
    }

    // Bid on open auctions
    const open = auctions.filter(a => a.isActive);
    if (open.length > 0) {
      const results = await bidOnEligibleAuctions(open);
      stats.bids   += results.filter(r => r.success && !r.simulated).length;
      stats.errors += results.filter(r => !r.success).length;
    }

    logger.info('📊 Stats', stats);
  } catch (err) {
    logger.error('Cycle error', { error: unwrapError(err) });
    stats.errors++;
  } finally {
    isRunning = false;
  }
}

function startCron() {
  const schedule = process.env.AUTO_TRADE_CRON || '*/2 * * * *';
  if (!cron.validate(schedule)) { logger.error(`Invalid cron: ${schedule}`); process.exit(1); }
  logger.info(`⏰ AutoTrader cron: "${schedule}" — Ctrl+C to stop`);
  runCycle();
  cron.schedule(schedule, runCycle);
}

module.exports = { runCycle, startCron };
