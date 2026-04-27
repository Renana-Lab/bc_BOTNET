const {
  getCampaign,
  getAccount,
  buildTxParams,
  resyncNonce,
  retryRpc,
  sendContractTransaction,
  unwrapError,
} = require('../chain');
const { fetchMyBudget, enrichAuctionsForAccount } = require('./auctions');
const logger = require('../config/logger');

const PROFILE_PRESETS = {
  conservative: { maxBid: '2000', minTimeSec: 120, skipIfWinning: true },
  balanced: { maxBid: '5000', minTimeSec: 60, skipIfWinning: true },
  aggressive: { maxBid: '12000', minTimeSec: 20, skipIfWinning: false },
};

const FIXED_OUTBID_WEI = 10n;

function getStrategy(mode = 'normal') {
  const profileName = process.env.TRADING_PROFILE || 'balanced';
  const preset = PROFILE_PRESETS[profileName] || PROFILE_PRESETS.balanced;

  const strategy = {
    profile: profileName,
    MAX_BID_WEI: BigInt(process.env.MAX_BID_WEI || preset.maxBid),
    OUTBID_BY_WEI: FIXED_OUTBID_WEI,
    MAX_MIN_CONTRIB: BigInt(process.env.MAX_MIN_CONTRIBUTION_WEI || '2000'),
    SKIP_IF_WINNING: process.env.SKIP_IF_WINNING !== undefined
      ? process.env.SKIP_IF_WINNING !== 'false'
      : preset.skipIfWinning,
    MIN_TIME_SEC: parseInt(process.env.MIN_TIME_REMAINING_SEC || String(preset.minTimeSec), 10),
  };

  if (mode === 'smart') {
    strategy.MAX_BID_WEI = BigInt(process.env.SMART_MAX_BID_WEI || '10000');
  }

  return strategy;
}

async function bidOnEligibleAuctions(auctions, mode = 'normal') {
  if (process.env.ENABLE_BIDDING === 'false') {
    logger.info('Bidding disabled by operator config');
    return [];
  }

  auctions = await enrichAuctionsForAccount(auctions, { onlyOpen: true });
  const myBudget = await fetchMyBudget();
  const simulate = process.env.BOT_MODE === 'simulate';
  const strategy = getStrategy(mode);

  logger.info('Bidder running', {
    mode: simulate ? 'SIMULATE' : mode.toUpperCase(),
    profile: strategy.profile,
    budgetWei: myBudget.toString(),
    maxBidWei: strategy.MAX_BID_WEI.toString(),
    outbidByWei: strategy.OUTBID_BY_WEI.toString(),
  });

  const results = [];
  const candidate = pickRandomAuctionForCycle(auctions);
  if (!candidate) {
    logger.info('No open auctions available for random bid cycle');
    return results;
  }

  const decision = shouldBid(candidate, myBudget, strategy, mode);
  if (!decision.bid) {
    logger.debug(`Skip ${candidate.address.slice(0, 10)}...: ${decision.reason}`);
    return results;
  }

  logger.info(`Randomly selected "${candidate.dataDescription}" for bid cycle`, {
    address: candidate.address,
    amountWei: decision.amount.toString(),
    currentHighestWei: candidate.highestBid.toString(),
    timeLeftSec: candidate.secondsLeft,
    amIWinning: candidate.amIWinning,
  });

  logger.info(`Bidding on "${candidate.dataDescription}"`, {
    address: candidate.address,
    amountWei: decision.amount.toString(),
    currentHighestWei: candidate.highestBid.toString(),
    timeLeftSec: candidate.secondsLeft,
  });

  if (simulate) {
    results.push({ auction: candidate, amount: decision.amount, success: true, simulated: true });
    return results;
  }

  try {
    const receipt = await placeBid(candidate.address, decision.amount);
    logger.ascii('bid sent', [
      `auction ${candidate.address.slice(0, 10)}...${candidate.address.slice(-6)}`,
      `amount  ${decision.amount.toString()} wei`,
    ], {
      message: `Bid sent for "${candidate.dataDescription}"`,
      address: candidate.address,
      amountWei: decision.amount.toString(),
      tx: receipt.transactionHash,
    });
    results.push({ auction: candidate, amount: decision.amount, success: true, tx: receipt.transactionHash });
  } catch (err) {
    const reason = unwrapError(err);
    logger.error(`Bid failed on ${candidate.address}`, { error: reason });
    results.push({ auction: candidate, amount: decision.amount, success: false, error: reason });
    await resyncNonce();
  }

  return results;
}

function shouldBid(auction, myBudget, strategy, mode = 'normal') {
  if (!auction.isActive) return { bid: false, reason: 'Auction closed' };
  if (auction.secondsLeft < strategy.MIN_TIME_SEC) {
    return { bid: false, reason: `Too little time left (${auction.secondsLeft}s)` };
  }
  if (auction.isManager) return { bid: false, reason: 'You are the seller' };
  if (auction.minimumContribution > strategy.MAX_MIN_CONTRIB) {
    return { bid: false, reason: 'Min contribution too high' };
  }

  const emptyAuction = Number(auction.approversCount || 0) === 0 && auction.highestBid === 0n;
  let bidAmount = emptyAuction
    ? auction.minimumContribution
    : auction.highestBid + strategy.OUTBID_BY_WEI;

  let sendAmount = bidAmount;
  if (auction.amIBidding && auction.myBid > 0n) {
    sendAmount = bidAmount - auction.myBid;
    if (sendAmount <= 0n) {
      return { bid: false, reason: 'Already covered' };
    }
  }

  if (bidAmount > strategy.MAX_BID_WEI) {
    return { bid: false, reason: 'Exceeds MAX_BID_WEI' };
  }
  if (sendAmount > myBudget) {
    return { bid: false, reason: 'Insufficient budget' };
  }

  return { bid: true, reason: 'OK', amount: sendAmount };
}

async function placeBid(auctionAddress, amountWei) {
  const account = getAccount();
  const campaign = getCampaign(auctionAddress);
  const value = amountWei.toString();

  const gas = await retryRpc(() => campaign.methods.contribute().estimateGas({ from: account.address, value }));
  const txParams = await buildTxParams({
    to: auctionAddress,
    value,
    gas: Math.ceil(Number(gas) * 1.2).toString(),
  });
  return retryRpc(
    () => sendContractTransaction(
      campaign.methods.contribute(),
      txParams,
      { action: 'bid', auction: auctionAddress, amountWei: value }
    ),
    2,
    1000
  );
}

async function finalizeAuction(auctionAddress) {
  if (process.env.ENABLE_FINALIZE === 'false') {
    logger.info(`Finalize skipped for ${auctionAddress} because finalization is disabled`);
    return { skipped: true };
  }

  const account = getAccount();
  const campaign = getCampaign(auctionAddress);
  const simulate = process.env.BOT_MODE === 'simulate';

  if (simulate) {
    logger.info(`Simulate finalize for ${auctionAddress}`);
    return { simulated: true };
  }

  try {
    const gas = await retryRpc(() => campaign.methods.finalizeAuctionIfNeeded().estimateGas({ from: account.address }));
    const txParams = await buildTxParams({
      to: auctionAddress,
      gas: Math.ceil(Number(gas) * 1.2).toString(),
    });
    return await retryRpc(
      () => sendContractTransaction(
        campaign.methods.finalizeAuctionIfNeeded(),
        txParams,
        { action: 'finalize', auction: auctionAddress }
      ),
      2,
      1000
    );
  } catch (err) {
    const reason = unwrapError(err);
    await resyncNonce();
    throw new Error(reason);
  }
}

function pickRandomAuctionForCycle(auctions) {
  const open = auctions.filter((auction) => auction.isActive);
  if (open.length === 0) return null;

  const notLeading = open.filter((auction) => !auction.amIWinning);
  const pool = notLeading.length > 0 ? notLeading : open;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { bidOnEligibleAuctions, placeBid, finalizeAuction, shouldBid, getStrategy, pickRandomAuctionForCycle };
