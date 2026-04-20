<<<<<<< HEAD
// auctions.js — fetches all auction states from chain
const { getFactory, getCampaign, getAccount, weiToEth } = require('./chain');
const logger = require('./logger');

async function fetchAllAuctions() {
  const factory = getFactory();
  const me = getAccount().address.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  let addresses = [];
  try {
    addresses = await factory.methods.getDeployedCampaigns().call();
    logger.info(`Fetching ${addresses.length} auctions...`);
  } catch (err) {
    logger.error('Failed to fetch deployed campaigns', { error: err.message });
    return [];
  }

  let failedCount = 0;
=======
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

>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
  const auctions = await Promise.all(
    addresses.map(async (address) => {
      try {
        const campaign = getCampaign(address);
<<<<<<< HEAD
        
        // Check if contract exists at address
        const code = await campaign.web3.eth.getCode(address);
        if (code === '0x') {
          failedCount++;
          return null;
        }

=======

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
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
        const [summary, closed, myBid] = await Promise.all([
          campaign.methods.getSummary().call(),
          campaign.methods.getStatus().call(),
          campaign.methods.getBid(me).call(),
        ]);

<<<<<<< HEAD
        const endTimeSec  = Number(summary[9]);
        const isActive    = endTimeSec > now;
        const secondsLeft = Math.max(0, endTimeSec - now);
        const isManager   = summary[3].toLowerCase() === me;
        const isWinner    = summary[7].toLowerCase() === me;
=======
        const endTimeSec   = Number(summary[9]);
        const isActive     = endTimeSec > now;
        const secondsLeft  = Math.max(0, endTimeSec - now);
        const isManager    = summary[3].toLowerCase() === me;
        const isWinner     = summary[7].toLowerCase() === me;
        const amIBidding   = Number(myBid) > 0;
        const amIWinning   = isWinner && isActive;
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a

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
<<<<<<< HEAD
=======
          // derived
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
          isActive,
          secondsLeft,
          isManager,
          isWinner,
<<<<<<< HEAD
          amIBidding: Number(myBid) > 0,
          amIWinning: isWinner && isActive,
          myBid:      BigInt(myBid),
        };
      } catch (err) {
        failedCount++;
=======
          amIBidding,
          amIWinning,
          myBid:               BigInt(myBid),
        };
      } catch (err) {
        logger.warn(`Failed to fetch auction ${address}`, { error: err.message });
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
        return null;
      }
    })
  );

<<<<<<< HEAD
  const valid = auctions.filter(Boolean);
  if (failedCount > 0) {
    logger.warn(`⚠️  ${failedCount}/${addresses.length} auctions failed to load — check FACTORY_ADDRESS and Campaign ABI`);
  }
  return valid;
}

async function fetchMyBudget() {
  const factory = getFactory();
  const me = getAccount().address;
  try {
    const budget = await factory.methods.getBudget(me).call();
    return BigInt(budget);
  } catch (err) {
    logger.error('Failed to fetch budget', { error: err.message });
    return 0n; // default to 0
  }
}

function printAuctions(auctions) {
  const me = getAccount().address.toLowerCase();
  logger.info(`\n${'═'.repeat(80)}`);
  logger.info(`  AUCTIONS  (${new Date().toLocaleTimeString()})   wallet: ${me}`);
  logger.info(`${'═'.repeat(80)}`);
  if (!auctions.length) { logger.info('  No auctions found.'); return; }

  for (const a of [...auctions].reverse()) {
    const status = a.isActive
      ? `🟢 OPEN (${formatTime(a.secondsLeft)} left)`
      : `🔴 CLOSED`;
    const myRole = a.isManager ? '👤 YOU ARE SELLER'
      : a.amIWinning ? '🏆 WINNING'
      : a.amIBidding ? `💸 BID: ${a.myBid} wei` : '';

    logger.info([
      `  📦 "${a.dataDescription}"`,
      `     ${a.address}`,
      `     ${status} | Min: ${a.minimumContribution} wei | Highest: ${a.highestBid} wei | Bidders: ${a.approversCount}`,
      myRole ? `     ${myRole}` : '',
    ].filter(Boolean).join('\n'));
  }
  logger.info(`${'═'.repeat(80)}\n`);
}

function formatTime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
=======
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
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
}

module.exports = { fetchAllAuctions, fetchMyBudget, printAuctions };
