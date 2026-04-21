const { getFactory, getCampaign, getAccount, getWeb3, retryRpc } = require('./chain');
const logger = require('./logger');

let lastAuctionSnapshot = [];
let lastAuctionSnapshotAt = null;
let lastBudgetValue = 0n;
let lastFetchPromise = null;
let lastBudgetFetchAt = 0;

const BUDGET_CACHE_TTL_MS = 15000;

async function fetchAllAuctions() {
  if (lastFetchPromise) {
    return lastFetchPromise;
  }

  lastFetchPromise = fetchAllAuctionsInternal();
  try {
    return await lastFetchPromise;
  } finally {
    lastFetchPromise = null;
  }
}

async function fetchAllAuctionsInternal() {
  const factory = getFactory();
  const me = getAccount().address.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  let addresses = [];
  try {
    addresses = await retryRpc(() => factory.methods.getDeployedCampaigns().call());
    logger.info(`Fetching ${addresses.length} auctions from chain`);
  } catch (err) {
    logger.error('Failed to fetch deployed campaigns', { error: err.message });
    if (lastAuctionSnapshot.length) {
      logger.warn('Using last successful auction snapshot');
      return refreshDerivedFields(lastAuctionSnapshot, now, me);
    }
    return [];
  }

  let failedCount = 0;
  const auctions = [];
  const batchSize = 3;

  for (let index = 0; index < addresses.length; index += batchSize) {
    const batch = addresses.slice(index, index + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (address) => {
      try {
        const campaign = getCampaign(address);
        const code = await retryRpc(() => getWeb3().eth.getCode(address));
        if (code === '0x') {
          failedCount++;
          return null;
        }

        const summary = await retryRpc(() => campaign.methods.getSummary().call());
        let closed = false;

        try {
          closed = await retryRpc(() => campaign.methods.getStatus().call());
        } catch (_) {
          const previous = findCachedAuction(address);
          closed = previous?.closed ?? false;
        }

        const endTimeSec = Number(summary[9]);
        const isActive = endTimeSec > now;
        const secondsLeft = Math.max(0, endTimeSec - now);
        const isManager = summary[3].toLowerCase() === me;
        const isWinner = summary[7].toLowerCase() === me;
        const previous = findCachedAuction(address);
        const myBid = previous?.myBid?.toString?.() ?? '0';
        const amIBidding = BigInt(myBid) > 0n;
        const amIWinning = isWinner && isActive;

        return {
          address,
          minimumContribution: BigInt(summary[0]),
          balance: BigInt(summary[1]),
          approversCount: Number(summary[2]),
          manager: summary[3],
          highestBid: BigInt(summary[4]),
          dataForSell: summary[5],
          dataDescription: summary[6],
          highestBidder: summary[7],
          bidderAddresses: summary[8],
          endTimeSec,
          closed,
          isActive,
          secondsLeft,
          isManager,
          isWinner,
          amIBidding,
          amIWinning,
          myBid: BigInt(myBid),
        };
      } catch (err) {
        const previous = findCachedAuction(address);
        if (previous) {
          logger.warn(`Using cached auction ${address}`, { error: err.message });
          return refreshDerivedFields([previous], now, me)[0];
        }
        failedCount++;
        logger.warn(`Failed to fetch auction ${address}`, { error: err.message });
        return {
          address,
          minimumContribution: 0n,
          balance: 0n,
          approversCount: 0,
          manager: '',
          highestBid: 0n,
          dataForSell: '',
          dataDescription: '(failed to load details)',
          highestBidder: '',
          bidderAddresses: [],
          endTimeSec: 0,
          closed: false,
          isActive: false,
          secondsLeft: 0,
          isManager: false,
          isWinner: false,
          amIBidding: false,
          amIWinning: false,
          myBid: 0n,
        };
      }
      })
    );
    auctions.push(...batchResults);
  }

  const validAuctions = auctions.filter(Boolean);
  if (validAuctions.length) {
    lastAuctionSnapshot = validAuctions;
    lastAuctionSnapshotAt = new Date().toISOString();
  }
  if (failedCount > 0) {
    logger.warn(`${failedCount}/${addresses.length} auctions failed to load`);
  }
  return validAuctions;
}

async function fetchMyBudget() {
  const now = Date.now();
  if (lastBudgetFetchAt && (now - lastBudgetFetchAt) < BUDGET_CACHE_TTL_MS) {
    return lastBudgetValue;
  }

  const factory = getFactory();
  const me = getAccount().address;
  try {
    const budget = await retryRpc(() => factory.methods.getBudget(me).call());
    lastBudgetValue = BigInt(budget);
    lastBudgetFetchAt = now;
    return lastBudgetValue;
  } catch (err) {
    logger.warn('Failed to fetch on-chain budget, falling back to wallet balance', { error: err.message });
    try {
      const balance = await retryRpc(() => getWeb3().eth.getBalance(me));
      lastBudgetValue = BigInt(balance);
      lastBudgetFetchAt = now;
      return lastBudgetValue;
    } catch (balanceErr) {
      logger.warn('Failed to fetch wallet balance, using last known budget value', { error: balanceErr.message });
      return lastBudgetValue;
    }
  }
}

function printAuctions(auctions) {
  const me = getAccount().address.toLowerCase();
  logger.info(`\n${'='.repeat(90)}`);
  logger.info(`  AUCTIONS (${new Date().toLocaleTimeString()}) wallet: ${me}`);
  logger.info(`${'='.repeat(90)}`);

  if (!auctions.length) {
    logger.info('  No auctions found.');
    return;
  }

  for (const auction of [...auctions].reverse()) {
    const status = auction.isActive
      ? `OPEN (${formatTime(auction.secondsLeft)} left)`
      : 'CLOSED';
    const myRole = auction.isManager ? 'YOU ARE SELLER'
      : auction.amIWinning ? 'WINNING'
      : auction.amIBidding ? `YOUR BID: ${auction.myBid} wei`
      : '';

    logger.info([
      `  "${auction.dataDescription || '(no description)'}"`,
      `     ${auction.address}`,
      `     ${status} | Min: ${auction.minimumContribution} wei | Highest: ${auction.highestBid} wei | Bidders: ${auction.approversCount}`,
      myRole ? `     ${myRole}` : '',
    ].filter(Boolean).join('\n'));
  }

  logger.info(`${'='.repeat(90)}\n`);
}

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function refreshDerivedFields(auctions, now, me) {
  return auctions.map((auction) => {
    const isActive = auction.endTimeSec > now;
    const secondsLeft = Math.max(0, auction.endTimeSec - now);
    const isWinner = String(auction.highestBidder).toLowerCase() === me;
    return {
      ...auction,
      isActive,
      secondsLeft,
      isWinner,
      amIWinning: isWinner && isActive,
    };
  });
}

function findCachedAuction(address) {
  return lastAuctionSnapshot.find((auction) => auction.address.toLowerCase() === address.toLowerCase()) || null;
}

async function enrichAuctionsForAccount(auctions, options = {}) {
  const me = getAccount().address.toLowerCase();
  const target = options.onlyOpen === false ? auctions : auctions.filter((auction) => auction.isActive);

  for (const auction of target) {
    try {
      const campaign = getCampaign(auction.address);
      const myBid = await retryRpc(() => campaign.methods.getBid(me).call());
      auction.myBid = BigInt(myBid);
      auction.amIBidding = auction.myBid > 0n;
      auction.amIWinning = auction.isActive && String(auction.highestBidder).toLowerCase() === me;
    } catch (err) {
      logger.warn(`Could not enrich bid state for ${auction.address}`, { error: err.message });
    }

    if (!auction.isActive && auction.isManager) {
      try {
        const campaign = getCampaign(auction.address);
        auction.closed = await retryRpc(() => campaign.methods.getStatus().call());
      } catch (_) {}
    }
  }

  if (auctions.length) {
    lastAuctionSnapshot = auctions;
    lastAuctionSnapshotAt = new Date().toISOString();
  }

  return auctions;
}

module.exports = { fetchAllAuctions, fetchMyBudget, printAuctions, enrichAuctionsForAccount };
