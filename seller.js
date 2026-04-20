// seller.js — creates auctions via factory.createCampaign()
const { getFactory, getAccount, buildTxParams, resyncNonce, unwrapError } = require('./chain');
const logger = require('./logger');
const fs   = require('fs');
const path = require('path');

async function createAuction(item) {
  const simulate = process.env.BOT_MODE === 'simulate';
  const factory  = getFactory();
  const account  = getAccount();
  const { minimumContribution, dataForSell, dataDescription, auctionDuration } = item;

  if (!Number.isInteger(Number(minimumContribution)) || Number(minimumContribution) <= 0)
    throw new Error(`minimumContribution must be a positive integer (got: ${minimumContribution})`);
  if (!Number.isInteger(Number(auctionDuration)) || auctionDuration < 1 || auctionDuration > 30)
    throw new Error(`auctionDuration must be 1–30 minutes (got: ${auctionDuration})`);
  if (!String(dataForSell).trim())        throw new Error('dataForSell cannot be empty');
  if (!String(dataDescription).trim())    throw new Error('dataDescription cannot be empty');

  logger.info(`Creating auction: "${dataDescription}"`, {
    minBid: minimumContribution + ' wei', duration: auctionDuration + ' min',
    mode: simulate ? 'SIMULATE' : 'LIVE',
  });

  if (simulate) {
    logger.info(`  [SIMULATE] Would call factory.createCampaign(...)`);
    return { simulated: true };
  }

  try {
    const args = [
      String(minimumContribution),
      String(dataForSell),
      String(dataDescription),
      String(auctionDuration),
    ];
    const gas = await factory.methods.createCampaign(...args).estimateGas({ from: account.address });
    const txParams = await buildTxParams({ gas: Math.ceil(Number(gas) * 1.2).toString() });
    const receipt  = await factory.methods.createCampaign(...args).send(txParams);
    const newAddress = receipt.events?.AuctionCreated?.returnValues?.campaignAddress;
    logger.info(`  ✅ Auction created`, { tx: receipt.transactionHash, address: newAddress });
    return { receipt, newAddress };
  } catch (err) {
    const reason = unwrapError(err);
    await resyncNonce();
    throw new Error(reason);
  }
}

async function createAuctionsFromConfig(configPath) {
  // Default: sell-list.json in same folder as this file
  const resolved = configPath
    ? path.resolve(configPath)
    : path.join(__dirname, 'sell-list.json');

  if (!fs.existsSync(resolved)) {
    logger.error(`sell-list.json not found at: ${resolved}`);
    return [];
  }

  const items = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  logger.info(`Batch creating ${items.length} auction(s)...`);

  const results = [];
  for (const item of items) {
    try {
      const r = await createAuction(item);
      results.push({ item, success: true, ...r });
    } catch (err) {
      logger.error(`Failed: "${item.dataDescription}"`, { error: err.message });
      results.push({ item, success: false, error: err.message });
    }
    await sleep(3000);
  }
  return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { createAuction, createAuctionsFromConfig };
