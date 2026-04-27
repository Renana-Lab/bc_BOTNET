const { fetchAllAuctions, fetchMyBudget, printAuctions } = require('../market/auctions');
const { shouldBid, getStrategy } = require('../market/bidder');
const { getAccount, weiToEth } = require('../chain');
const logger = require('../config/logger');

async function runSimulation(mode = 'normal') {
  const me = getAccount().address;
  const auctions = await fetchAllAuctions();

  logger.info('Simulation mode - no transactions will be sent');
  logger.info(`Wallet: ${me}`);

  if (auctions.length === 0) {
    logger.warn('No auctions loaded');
    return;
  }

  printAuctions(auctions);

  const myBudget = await fetchMyBudget();
  const strategy = getStrategy(mode);
  logger.info(`Budget: ${myBudget} wei (${weiToEth(myBudget)} ETH)`);
  logger.info(`Strategy profile: ${strategy.profile}`);

  for (const auction of auctions.filter((a) => a.isActive)) {
    const decision = shouldBid(auction, myBudget, strategy, mode);
    logger.info(`"${auction.dataDescription}" -> ${decision.bid ? `would bid ${decision.amount} wei` : decision.reason}`);
  }

  const toFinalize = auctions.filter((a) => !a.isActive && !a.closed && a.isManager && a.approversCount > 0);
  logger.info(`Auctions to finalize: ${toFinalize.length}`);
  const won = auctions.filter((a) => !a.isActive && a.isWinner);
  logger.info(`Won auctions: ${won.length}`);
}

module.exports = { runSimulation };
