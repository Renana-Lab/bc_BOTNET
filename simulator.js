// src/simulator.js
// Simulates a human user session: reads auctions, analyses them, logs decisions,
// but sends ZERO transactions. Safe for testing without spending gas.

const { fetchAllAuctions, fetchMyBudget, printAuctions } = require('./auctions');
const { shouldBid } = require('./bidder');
const { getAccount, weiToEth } = require('./chain');
const logger = require('./logger');

async function runSimulation() {
  const me = getAccount().address;
  logger.info('🎭 === SIMULATION MODE — no transactions will be sent ===');
  logger.info(`   Bot wallet: ${me}\n`);

  // Step 1: snapshot the marketplace
  logger.info('[SIM] Step 1: Fetching all auctions from chain...');
  const auctions = await fetchAllAuctions();
  printAuctions(auctions);

  // Step 2: check budget
  const myBudget = await fetchMyBudget();
  logger.info(`[SIM] Step 2: On-chain budget = ${myBudget} wei (${weiToEth(myBudget)} ETH)\n`);

  // Step 3: evaluate each auction as the bidder would
  logger.info('[SIM] Step 3: Evaluating bidding opportunities...');
  for (const auction of auctions.filter(a => a.isActive)) {
    const decision = shouldBid(auction, me.toLowerCase(), myBudget);
    const icon = decision.bid ? '✅' : '⏭ ';
    logger.info(`  ${icon} "${auction.dataDescription}" [${auction.address.slice(0, 10)}…]`);
    logger.info(`       → ${decision.bid ? `Would bid ${decision.amount} wei` : `Skip: ${decision.reason}`}`);
  }

  // Step 4: check if any closed auctions need finalizing
  logger.info('\n[SIM] Step 4: Checking for auctions to finalize...');
  const toFinalize = auctions.filter(a => !a.isActive && !a.closed && a.isManager && a.approversCount > 0);
  if (toFinalize.length === 0) {
    logger.info('  No auctions need finalizing.');
  } else {
    for (const a of toFinalize) {
      logger.info(`  ⚡ Would finalize: "${a.dataDescription}" [${a.address}] — highest bid: ${a.highestBid} wei`);
    }
  }

  // Step 5: check if you've won any closed auctions
  logger.info('\n[SIM] Step 5: Checking for won auctions...');
  const won = auctions.filter(a => !a.isActive && a.isWinner);
  if (won.length === 0) {
    logger.info('  No won auctions.');
  } else {
    for (const a of won) {
      logger.info(`  🏆 WON: "${a.dataDescription}" — data: "${a.dataForSell}"`);
    }
  }

  logger.info('\n🎭 === Simulation complete — no gas spent ===\n');
}

module.exports = { runSimulation };
