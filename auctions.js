// src/auctions.js
// Fetches all deployed auctions and their full on-chain state.
// Mirrors exactly what AuctionsListPage.js + ShowAuctionPage.js do.

const { getFactory, getCampaign, getAccount, weiToEth } = require('./chain');
const logger = require('./logger');

/**
 * Fetch every deployed auction with its full summary.
 * Returns an array of enriched auction objects.
 */
async function fetchAllAuctions() {
  const factory = getFactory();
  const me = getAccount().address.toLowerCase();

  const addresses = await factory.methods.getDeployedCampaigns().call();
  logger.info(`Fetching ${addresses.length} auctions from chain...`);

  const now = Math.floor(Date.now() / 1000); // current time in seconds

  const auctions = await Promise.all(
    addresses.map(async (address) => {
      try {
        const campaign = getCampaign(address);

        // getSummary() returns:
        // [0] minimumContribution
        // [1] balance
        // [2] approversCount
        // [3] manager
        // [4] highestBid
        // [5] dataForSell
        // [6] dataDescription
        // [7] highestBidder
        // [8] addresses[]
        // [9] endTime (unix seconds)
        const [summary, closed, myBid] = await Promise.all([
          campaign.methods.getSummary().call(),
          campaign.methods.getStatus().call(),
          campaign.methods.getBid(me).call(),
        ]);

        const endTimeSec   = Number(summary[9]);
        const isActive     = endTimeSec > now;
        const secondsLeft  = Math.max(0, endTimeSec - now);
        const isManager    = summary[3].toLowerCase() === me;
        const isWinner     = summary[7].toLowerCase() === me;
        const amIBidding   = Number(myBid) > 0;
        const amIWinning   = isWinner && isActive;

        return {
          address,
          minimumContribution: BigInt(summary[0]),
          balance:             BigInt(summary[1]),
          approversCount:      Number(summary[2]),
          manager:             summary[3],
          highestBid:          BigInt(summary[4]),
          dataForSell:         summary[5],
          dataDescription:     summary[6],
          highestBidder:       summary[7],
          bidderAddresses:     summary[8],
          endTimeSec,
          closed,
          // derived
          isActive,
          secondsLeft,
          isManager,
          isWinner,
          amIBidding,
          amIWinning,
          myBid:               BigInt(myBid),
        };
      } catch (err) {
        logger.warn(`Failed to fetch auction ${address}`, { error: err.message });
        return null;
      }
    })
  );

  return auctions.filter(Boolean);
}

/**
 * Fetch the current wallet budget from the factory.
 */
async function fetchMyBudget() {
  const factory = getFactory();
  const me = getAccount().address;
  const budget = await factory.methods.getBudget(me).call();
  return BigInt(budget);
}

/**
 * Print a human-readable summary table to console.
 */
function printAuctions(auctions) {
  const me = getAccount().address.toLowerCase();
  logger.info(`\n${'═'.repeat(90)}`);
  logger.info(`  AUCTION SNAPSHOT  (${new Date().toLocaleTimeString()})   Bot wallet: ${me}`);
  logger.info(`${'═'.repeat(90)}`);

  if (auctions.length === 0) {
    logger.info('  No auctions found on-chain.');
    return;
  }

  for (const a of [...auctions].reverse()) {
    const status = a.isActive
      ? `🟢 OPEN  (${formatTime(a.secondsLeft)} left)`
      : `🔴 CLOSED`;
    const myRole = a.isManager
      ? '👤 YOU ARE SELLER'
      : a.amIWinning
        ? '🏆 YOU ARE WINNING'
        : a.amIBidding
          ? `💸 YOUR BID: ${a.myBid} wei`
          : '';

    logger.info([
      `  📦 ${a.dataDescription || '(no description)'}`,
      `     Address: ${a.address}`,
      `     Status:  ${status}`,
      `     Min bid: ${a.minimumContribution} wei | Highest: ${a.highestBid} wei | Bidders: ${a.approversCount}`,
      myRole ? `     ${myRole}` : '',
    ].filter(Boolean).join('\n'));
  }
  logger.info(`${'═'.repeat(90)}\n`);
}

function formatTime(seconds) {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

module.exports = { fetchAllAuctions, fetchMyBudget, printAuctions };
