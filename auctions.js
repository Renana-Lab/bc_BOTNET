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
  const auctions = await Promise.all(
    addresses.map(async (address) => {
      try {
        const campaign = getCampaign(address);
        
        // Check if contract exists at address
        const code = await campaign.web3.eth.getCode(address);
        if (code === '0x') {
          failedCount++;
          return null;
        }

        const [summary, closed, myBid] = await Promise.all([
          campaign.methods.getSummary().call(),
          campaign.methods.getStatus().call(),
          campaign.methods.getBid(me).call(),
        ]);

        const endTimeSec  = Number(summary[9]);
        const isActive    = endTimeSec > now;
        const secondsLeft = Math.max(0, endTimeSec - now);
        const isManager   = summary[3].toLowerCase() === me;
        const isWinner    = summary[7].toLowerCase() === me;

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
          isActive,
          secondsLeft,
          isManager,
          isWinner,
          amIBidding: Number(myBid) > 0,
          amIWinning: isWinner && isActive,
          myBid:      BigInt(myBid),
        };
      } catch (err) {
        failedCount++;
        return null;
      }
    })
  );

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
}

module.exports = { fetchAllAuctions, fetchMyBudget, printAuctions };
