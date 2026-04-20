// simulator.js — read-only dry run, zero transactions
const { fetchAllAuctions, fetchMyBudget, printAuctions } = require('./auctions');
const { shouldBid } = require('./bidder');
const { getAccount, weiToEth } = require('./chain');
const logger = require('./logger');

async function runSimulation() {
  const me = getAccount().address;
  logger.info('🎭 SIMULATION — no transactions will be sent');
  logger.info(`   Wallet: ${me}\n`);

  const auctions = await fetchAllAuctions();
  
  if (auctions.length === 0) {
    logger.warn('⚠️  No auctions loaded. This usually means:');
    logger.warn('   1. FACTORY_ADDRESS is incorrect (check .env)');
    logger.warn('   2. Campaign ABI doesn\'t match deployed contracts');
    logger.warn('   3. No auctions exist yet on this factory');
    logger.info('\nRun 🔧 Diagnostics from admin panel for details\n');
    return;
  }

  printAuctions(auctions);

  const myBudget = await fetchMyBudget();
  logger.info(`Budget: ${myBudget} wei (${weiToEth(myBudget)} ETH)\n`);

  logger.info('Evaluating bid opportunities...');
  for (const a of auctions.filter(x => x.isActive)) {
    const d = shouldBid(a, me.toLowerCase(), myBudget);
    logger.info(`  ${d.bid ? '✅' : '⏭ '} "${a.dataDescription}" → ${d.bid ? `Would bid ${d.amount} wei` : d.reason}`);
  }

  const toFinalize = auctions.filter(a => !a.isActive && !a.closed && a.isManager && a.approversCount > 0);
  logger.info(`\nAuctions to finalize: ${toFinalize.length}`);
  toFinalize.forEach(a => logger.info(`  ⚡ "${a.dataDescription}" — highest bid: ${a.highestBid} wei`));

  const won = auctions.filter(a => !a.isActive && a.isWinner);
  logger.info(`Won auctions: ${won.length}`);
  won.forEach(a => logger.info(`  🏆 "${a.dataDescription}" — data: "${a.dataForSell}"`));

  logger.info('\n🎭 Simulation complete\n');
}

module.exports = { runSimulation };
