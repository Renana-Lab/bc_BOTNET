const { getCampaign, getAccount, getWeb3, buildTxParams, resyncNonce, retryRpc, unwrapError } = require('./chain');
const { fetchMyBudget, enrichAuctionsForAccount } = require('./auctions');
const logger = require('./logger');

const PROFILE_PRESETS = {
  conservative: { maxBid: '2000', outbidBy: '50', minTimeSec: 120, skipIfWinning: true },
  balanced: { maxBid: '5000', outbidBy: '100', minTimeSec: 60, skipIfWinning: true },
  aggressive: { maxBid: '12000', outbidBy: '250', minTimeSec: 20, skipIfWinning: false },
};

function getStrategy(mode = 'normal') {
  const profileName = process.env.TRADING_PROFILE || 'balanced';
  const preset = PROFILE_PRESETS[profileName] || PROFILE_PRESETS.balanced;

  const strategy = {
    profile: profileName,
    MAX_BID_WEI: BigInt(process.env.MAX_BID_WEI || preset.maxBid),
    OUTBID_BY_WEI: BigInt(process.env.OUTBID_BY_WEI || preset.outbidBy),
    MAX_MIN_CONTRIB: BigInt(process.env.MAX_MIN_CONTRIBUTION_WEI || '2000'),
    SKIP_IF_WINNING: process.env.SKIP_IF_WINNING !== undefined
      ? process.env.SKIP_IF_WINNING !== 'false'
      : preset.skipIfWinning,
    MIN_TIME_SEC: parseInt(process.env.MIN_TIME_REMAINING_SEC || String(preset.minTimeSec), 10),
  };

  if (mode === 'smart') {
    strategy.OUTBID_BY_WEI = BigInt(process.env.SMART_OUTBID_BY_WEI || '200');
    strategy.MAX_BID_WEI = BigInt(process.env.SMART_MAX_BID_WEI || '10000');
  } else if (mode === 'dumb') {
    strategy.OUTBID_BY_WEI = BigInt(process.env.DUMB_OUTBID_BY_WEI || '50');
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
  const walletBalance = BigInt(await retryRpc(() => getWeb3().eth.getBalance(getAccount().address)));
  const simulate = process.env.BOT_MODE === 'simulate';
  const strategy = getStrategy(mode);

  logger.info('Bidder running', {
    mode: simulate ? 'SIMULATE' : mode.toUpperCase(),
    profile: strategy.profile,
    budgetWei: myBudget.toString(),
    walletBalanceWei: walletBalance.toString(),
    maxBidWei: strategy.MAX_BID_WEI.toString(),
    outbidByWei: strategy.OUTBID_BY_WEI.toString(),
  });

  const results = [];
  const skipped = [];
  for (const auction of auctions) {
    const decision = shouldBid(auction, myBudget, strategy, mode);
    if (!decision.bid) {
      logger.debug(`Skip ${auction.address.slice(0, 10)}...: ${decision.reason}`);
      skipped.push({ auction, reason: decision.reason });
      continue;
    }

    logger.info(`Bidding on "${auction.dataDescription}"`, {
      address: auction.address,
      amountWei: decision.amount.toString(),
      currentHighestWei: auction.highestBid.toString(),
      timeLeftSec: auction.secondsLeft,
    });

    if (simulate) {
      results.push({ auction, amount: decision.amount, success: true, simulated: true });
      continue;
    }

    try {
      const receipt = await placeBid(auction.address, decision.amount);
      logger.info(`Bid sent for "${auction.dataDescription}"`, {
        address: auction.address,
        amountWei: decision.amount.toString(),
        tx: receipt.transactionHash,
      });
      results.push({ auction, amount: decision.amount, success: true, tx: receipt.transactionHash });
    } catch (err) {
      const reason = unwrapError(err);
      logger.error(`Bid failed on ${auction.address}`, { error: reason });
      results.push({ auction, amount: decision.amount, success: false, error: reason });
      await resyncNonce();
    }

    await sleep(1500);
  }

  if (!results.some((result) => result.success) && skipped.length > 0) {
    const exploratory = pickExploratoryBid(skipped, walletBalance, strategy);
    if (exploratory) {
      logger.info(`No standard bid candidates found, attempting exploratory bid on "${exploratory.auction.dataDescription}"`, {
        address: exploratory.auction.address,
        amountWei: exploratory.amount.toString(),
        reason: exploratory.reason,
      });

      if (simulate) {
        results.push({ auction: exploratory.auction, amount: exploratory.amount, success: true, simulated: true, exploratory: true });
      } else {
        try {
          const receipt = await placeBid(exploratory.auction.address, exploratory.amount);
          logger.info(`Exploratory bid sent for "${exploratory.auction.dataDescription}"`, {
            address: exploratory.auction.address,
            amountWei: exploratory.amount.toString(),
            tx: receipt.transactionHash,
          });
          results.push({ auction: exploratory.auction, amount: exploratory.amount, success: true, tx: receipt.transactionHash, exploratory: true });
        } catch (err) {
          const reason = unwrapError(err);
          logger.error(`Exploratory bid failed on ${exploratory.auction.address}`, { error: reason });
          results.push({ auction: exploratory.auction, amount: exploratory.amount, success: false, error: reason, exploratory: true });
          await resyncNonce();
        }
      }
    }
  }

  return results;
}

function shouldBid(auction, myBudget, strategy, mode = 'normal') {
  if (!auction.isActive) return { bid: false, reason: 'Auction closed' };
  if (auction.secondsLeft < strategy.MIN_TIME_SEC) {
    return { bid: false, reason: `Too little time left (${auction.secondsLeft}s)` };
  }
  if (auction.isManager) return { bid: false, reason: 'You are the seller' };
  if (strategy.SKIP_IF_WINNING && auction.amIWinning) {
    return { bid: false, reason: 'Already winning' };
  }
  if (auction.minimumContribution > strategy.MAX_MIN_CONTRIB) {
    return { bid: false, reason: 'Min contribution too high' };
  }

  let bidAmount = auction.approversCount === 0
    ? auction.minimumContribution
    : auction.highestBid + strategy.OUTBID_BY_WEI;

  let sendAmount = bidAmount;
  if (auction.amIBidding && auction.myBid > 0n) {
    sendAmount = bidAmount - auction.myBid;
    if (sendAmount <= 0n) {
      return { bid: false, reason: 'Already covered' };
    }
  }

  if (sendAmount > strategy.MAX_BID_WEI) {
    return { bid: false, reason: 'Exceeds MAX_BID_WEI' };
  }
  if (sendAmount > myBudget) {
    return { bid: false, reason: 'Insufficient budget' };
  }
  if (mode === 'dumb' && Math.random() < 0.5) {
    return { bid: false, reason: 'Random skip in dumb mode' };
  }

  return { bid: true, reason: 'OK', amount: sendAmount };
}

async function placeBid(auctionAddress, amountWei) {
  const account = getAccount();
  const campaign = getCampaign(auctionAddress);
  const value = amountWei.toString();

  const gas = await retryRpc(() => campaign.methods.contribute().estimateGas({ from: account.address, value }));
  const txParams = await buildTxParams({
    value,
    gas: Math.ceil(Number(gas) * 1.2).toString(),
  });
  return retryRpc(() => campaign.methods.contribute().send(txParams), 2, 1000);
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
    const txParams = await buildTxParams({ gas: Math.ceil(Number(gas) * 1.2).toString() });
    return await retryRpc(() => campaign.methods.finalizeAuctionIfNeeded().send(txParams), 2, 1000);
  } catch (err) {
    const reason = unwrapError(err);
    await resyncNonce();
    throw new Error(reason);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickExploratoryBid(skipped, walletBalance, strategy) {
  const viable = skipped
    .map(({ auction, reason }) => {
      const targetBid = auction.approversCount === 0
        ? auction.minimumContribution
        : auction.highestBid + strategy.OUTBID_BY_WEI;
      const sendAmount = auction.amIBidding && auction.myBid > 0n
        ? targetBid - auction.myBid
        : targetBid;
      return { auction, reason, amount: sendAmount };
    })
    .filter((item) => item.amount > 0n && item.amount <= walletBalance && !item.auction.isManager && item.auction.isActive)
    .sort((left, right) => Number(left.amount - right.amount));

  return viable[0] || null;
}

module.exports = { bidOnEligibleAuctions, placeBid, finalizeAuction, shouldBid, getStrategy };
