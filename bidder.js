<<<<<<< HEAD
// bidder.js — places bids and finalizes auctions
const { getCampaign, getAccount, buildTxParams, resyncNonce, unwrapError } = require('./chain');
const { fetchMyBudget } = require('./auctions');
const logger = require('./logger');

function cfg(mode = 'normal') {
  const base = {
    MAX_BID_WEI:     BigInt(process.env.MAX_BID_WEI                || '5000'),
    OUTBID_BY_WEI:   BigInt(process.env.OUTBID_BY_WEI              || '100'),
    MAX_MIN_CONTRIB: BigInt(process.env.MAX_MIN_CONTRIBUTION_WEI   || '2000'),
    SKIP_IF_WINNING: process.env.SKIP_IF_WINNING !== 'false',
    MIN_TIME_SEC:    parseInt(process.env.MIN_TIME_REMAINING_SEC    || '60'),
  };

  if (mode === 'smart') {
    base.OUTBID_BY_WEI = BigInt(process.env.SMART_OUTBID_BY_WEI || '200'); // outbid more aggressively
    base.MAX_BID_WEI = BigInt(process.env.SMART_MAX_BID_WEI || '10000'); // allow higher bids
  } else if (mode === 'dumb') {
    base.OUTBID_BY_WEI = BigInt(process.env.DUMB_OUTBID_BY_WEI || '50'); // outbid less
  }

  return base;
}

async function bidOnEligibleAuctions(auctions, mode = 'normal') {
  const me = getAccount().address.toLowerCase();
  const myBudget = await fetchMyBudget();
  const simulate = process.env.BOT_MODE === 'simulate';
  const { MAX_BID_WEI, OUTBID_BY_WEI } = cfg(mode);

  logger.info('Bidder running', {
    mode: simulate ? 'SIMULATE' : mode.toUpperCase(),
    budget: myBudget.toString() + ' wei',
    maxBid: MAX_BID_WEI.toString(),
=======
// src/bidder.js
// Places bids on open auctions by calling campaign.contribute()
// Mirrors exactly what ContributeForm does in the frontend.

const { getCampaign, getAccount, getWeb3 } = require('./chain');
const { fetchMyBudget } = require('./auctions');
const logger = require('./logger');

const MAX_BID_WEI       = BigInt(process.env.MAX_BID_WEI       || '5000');
const OUTBID_BY_WEI     = BigInt(process.env.OUTBID_BY_WEI     || '100');
const MAX_MIN_CONTRIB   = BigInt(process.env.MAX_MIN_CONTRIBUTION_WEI || '2000');
const SKIP_IF_WINNING   = process.env.SKIP_IF_WINNING !== 'false';
const MIN_TIME_SEC      = parseInt(process.env.MIN_TIME_REMAINING_SEC || '60');

/**
 * Evaluate all open auctions and bid on the ones that meet strategy criteria.
 * Returns an array of bid results.
 */
async function bidOnEligibleAuctions(auctions) {
  const me = getAccount().address.toLowerCase();
  const myBudget = await fetchMyBudget();
  const simulate = process.env.BOT_MODE === 'simulate';

  logger.info(`Bidder running`, {
    mode: simulate ? 'SIMULATE' : 'LIVE',
    walletBudget: myBudget.toString() + ' wei',
    maxBidWei: MAX_BID_WEI.toString(),
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
    outbidBy: OUTBID_BY_WEI.toString(),
  });

  const results = [];
<<<<<<< HEAD
  for (const auction of auctions) {
    const decision = shouldBid(auction, me, myBudget, mode);
    if (!decision.bid) {
      logger.debug(`Skip ${auction.address.slice(0,10)}…: ${decision.reason}`);
      continue;
    }

    logger.info(`🎯 Bidding: "${auction.dataDescription}"`, {
      amount: decision.amount.toString() + ' wei',
      highest: auction.highestBid.toString() + ' wei',
=======

  for (const auction of auctions) {
    const decision = shouldBid(auction, me, myBudget);

    if (!decision.bid) {
      logger.debug(`Skipping auction ${auction.address.slice(0, 10)}…: ${decision.reason}`);
      continue;
    }

    logger.info(`🎯 Bidding on: "${auction.dataDescription}"`, {
      address: auction.address,
      bidAmount: decision.amount.toString() + ' wei',
      currentHighest: auction.highestBid.toString() + ' wei',
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      timeLeft: auction.secondsLeft + 's',
    });

    if (simulate) {
<<<<<<< HEAD
      logger.info(`  [SIMULATE] Would bid ${decision.amount} wei`);
=======
      logger.info(`  [SIMULATE] Would call contribute() with ${decision.amount} wei — skipping actual tx`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
      results.push({ auction, amount: decision.amount, success: true, simulated: true });
      continue;
    }

    try {
      const receipt = await placeBid(auction.address, decision.amount);
<<<<<<< HEAD
      logger.info(`  ✅ Bid placed!`, { tx: receipt.transactionHash });
      results.push({ auction, amount: decision.amount, success: true, tx: receipt.transactionHash });
    } catch (err) {
      const reason = unwrapError(err);
      logger.error(`  ❌ Bid failed: ${reason}`);
      results.push({ auction, amount: decision.amount, success: false, error: reason });
      await resyncNonce();
    }
    await sleep(2000);
  }
  return results;
}

function shouldBid(auction, me, myBudget, mode = 'normal') {
  const { MAX_BID_WEI, OUTBID_BY_WEI, MAX_MIN_CONTRIB, SKIP_IF_WINNING, MIN_TIME_SEC } = cfg(mode);

  if (!auction.isActive)                         return { bid: false, reason: 'Auction closed' };
  if (auction.secondsLeft < MIN_TIME_SEC)        return { bid: false, reason: `Too little time (${auction.secondsLeft}s)` };
  if (auction.isManager)                         return { bid: false, reason: 'You are the seller' };
  if (SKIP_IF_WINNING && auction.amIWinning)     return { bid: false, reason: 'Already winning' };
  if (auction.minimumContribution > MAX_MIN_CONTRIB) return { bid: false, reason: `Min contribution too high` };

  let bidAmount = auction.approversCount === 0
    ? auction.minimumContribution
    : auction.highestBid + OUTBID_BY_WEI;

  let sendAmount = bidAmount;
  if (auction.amIBidding && auction.myBid > 0n) {
    sendAmount = bidAmount - auction.myBid;
    if (sendAmount <= 0n) return { bid: false, reason: 'Already covered' };
  }

  if (sendAmount > MAX_BID_WEI)   return { bid: false, reason: `Exceeds MAX_BID_WEI` };
  if (sendAmount > myBudget)      return { bid: false, reason: `Insufficient budget` };

  if (mode === 'dumb' && Math.random() < 0.5) return { bid: false, reason: 'Random skip for dumb mode' };

  return { bid: true, reason: 'OK', amount: sendAmount };
}

async function placeBid(auctionAddress, amountWei) {
  const account  = getAccount();
  const campaign = getCampaign(auctionAddress);
  const valueStr = amountWei.toString();

  const gas = await campaign.methods.contribute().estimateGas({ from: account.address, value: valueStr });
  const txParams = await buildTxParams({ value: valueStr, gas: Math.ceil(Number(gas) * 1.2).toString() });
  return campaign.methods.contribute().send(txParams);
}

async function finalizeAuction(auctionAddress) {
  const account  = getAccount();
  const campaign = getCampaign(auctionAddress);
  const simulate = process.env.BOT_MODE === 'simulate';

  logger.info(`Finalizing: ${auctionAddress}`);
  if (simulate) { logger.info('  [SIMULATE] Would finalize'); return { simulated: true }; }

  try {
    const gas = await campaign.methods.finalizeAuctionIfNeeded().estimateGas({ from: account.address });
    const txParams = await buildTxParams({ gas: Math.ceil(Number(gas) * 1.2).toString() });
    const receipt = await campaign.methods.finalizeAuctionIfNeeded().send(txParams);
    logger.info(`  ✅ Finalized`, { tx: receipt.transactionHash });
    return receipt;
  } catch (err) {
    const reason = unwrapError(err);
    logger.error(`  ❌ Finalize failed: ${reason}`);
    await resyncNonce();
    throw new Error(reason);
  }
=======
      logger.info(`  ✅ Bid placed!`, { tx: receipt.transactionHash, gas: receipt.gasUsed.toString() });
      results.push({ auction, amount: decision.amount, success: true, tx: receipt.transactionHash });
    } catch (err) {
      logger.error(`  ❌ Bid failed on ${auction.address}`, { error: err.message });
      results.push({ auction, amount: decision.amount, success: false, error: err.message });
    }

    // Small delay between bids
    await sleep(2000);
  }

  return results;
}

/**
 * Decide whether to bid on a given auction, and how much.
 */
function shouldBid(auction, me, myBudget) {
  if (!auction.isActive)
    return { bid: false, reason: 'Auction closed' };

  if (auction.secondsLeft < MIN_TIME_SEC)
    return { bid: false, reason: `Too little time left (${auction.secondsLeft}s < ${MIN_TIME_SEC}s)` };

  if (auction.isManager)
    return { bid: false, reason: 'You are the seller — cannot bid on own auction' };

  if (SKIP_IF_WINNING && auction.amIWinning)
    return { bid: false, reason: 'Already winning — SKIP_IF_WINNING=true' };

  if (auction.minimumContribution > MAX_MIN_CONTRIB)
    return { bid: false, reason: `Min contribution ${auction.minimumContribution} > MAX_MIN_CONTRIBUTION_WEI ${MAX_MIN_CONTRIB}` };

  // Calculate bid amount:
  // If no bids yet → use minimumContribution
  // Else → current highestBid + OUTBID_BY_WEI
  let bidAmount;
  if (auction.approversCount === 0) {
    bidAmount = auction.minimumContribution;
  } else {
    bidAmount = auction.highestBid + OUTBID_BY_WEI;
  }

  // If we already have a bid on this auction, we only need to send the increment
  // (the contract adds msg.value to existing approversMoney[sender])
  let sendAmount = bidAmount;
  if (auction.amIBidding && auction.myBid > 0n) {
    // Already have some funds in — send only the diff
    sendAmount = bidAmount - auction.myBid;
    if (sendAmount <= 0n) return { bid: false, reason: 'Already have highest bid covered' };
  }

  if (sendAmount > MAX_BID_WEI)
    return { bid: false, reason: `Would send ${sendAmount} wei which exceeds MAX_BID_WEI ${MAX_BID_WEI}` };

  if (sendAmount > myBudget)
    return { bid: false, reason: `Insufficient on-chain budget: need ${sendAmount} wei, have ${myBudget} wei` };

  return { bid: true, reason: 'All conditions met', amount: sendAmount };
}

/**
 * Send the actual contribute() transaction.
 */
async function placeBid(auctionAddress, amountWei) {
  const web3 = getWeb3();
  const account = getAccount();
  const campaign = getCampaign(auctionAddress);

  // Estimate gas first
  const gas = await campaign.methods.contribute().estimateGas({
    from: account.address,
    value: amountWei.toString(),
  });

  const receipt = await campaign.methods.contribute().send({
    from: account.address,
    value: amountWei.toString(),
    gas: Math.ceil(Number(gas) * 1.2), // 20% buffer
  });

  return receipt;
}

/**
 * Finalize an ended auction (only callable by the manager/seller).
 * Calls finalizeAuctionIfNeeded() — pays out manager and refunds losers.
 */
async function finalizeAuction(auctionAddress) {
  const account = getAccount();
  const campaign = getCampaign(auctionAddress);
  const simulate = process.env.BOT_MODE === 'simulate';

  logger.info(`Finalizing auction: ${auctionAddress}`);

  if (simulate) {
    logger.info(`  [SIMULATE] Would call finalizeAuctionIfNeeded() — skipping`);
    return { simulated: true };
  }

  const gas = await campaign.methods.finalizeAuctionIfNeeded().estimateGas({ from: account.address });
  const receipt = await campaign.methods.finalizeAuctionIfNeeded().send({
    from: account.address,
    gas: Math.ceil(Number(gas) * 1.2),
  });

  logger.info(`  ✅ Auction finalized`, { tx: receipt.transactionHash });
  return receipt;
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { bidOnEligibleAuctions, placeBid, finalizeAuction, shouldBid };
