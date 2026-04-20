<<<<<<< HEAD
// seller.js — creates auctions via factory.createCampaign()
const { getFactory, getAccount, buildTxParams, resyncNonce, unwrapError } = require('./chain');
const logger = require('./logger');
const fs   = require('fs');
const path = require('path');

=======
// src/seller.js
// Creates new data auctions by calling factory.createCampaign()
// Mirrors exactly what NewAuctionPage.js does.

const { getFactory, getAccount } = require('./chain');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

/**
 * Create a single auction listing.
 *
 * @param {object} item
 * @param {number} item.minimumContribution  - min bid in Wei (positive integer)
 * @param {string} item.dataForSell          - the actual data string being sold
 * @param {string} item.dataDescription      - public description visible in the list
 * @param {number} item.auctionDuration      - duration in MINUTES (1–30), as per the contract
 */
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
async function createAuction(item) {
  const simulate = process.env.BOT_MODE === 'simulate';
  const factory  = getFactory();
  const account  = getAccount();
<<<<<<< HEAD
=======

  // Validate — mirrors NewAuctionPage.js validateForm()
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
  const { minimumContribution, dataForSell, dataDescription, auctionDuration } = item;

  if (!Number.isInteger(Number(minimumContribution)) || Number(minimumContribution) <= 0)
    throw new Error(`minimumContribution must be a positive integer (got: ${minimumContribution})`);
<<<<<<< HEAD
  if (!Number.isInteger(Number(auctionDuration)) || auctionDuration < 1 || auctionDuration > 30)
    throw new Error(`auctionDuration must be 1–30 minutes (got: ${auctionDuration})`);
  if (!String(dataForSell).trim())        throw new Error('dataForSell cannot be empty');
  if (!String(dataDescription).trim())    throw new Error('dataDescription cannot be empty');

  logger.info(`Creating auction: "${dataDescription}"`, {
    minBid: minimumContribution + ' wei', duration: auctionDuration + ' min',
=======

  if (!Number.isInteger(Number(auctionDuration)) || auctionDuration < 1 || auctionDuration > 30)
    throw new Error(`auctionDuration must be an integer between 1 and 30 (got: ${auctionDuration})`);

  if (!String(dataForSell).trim())
    throw new Error('dataForSell cannot be empty');

  if (!String(dataDescription).trim())
    throw new Error('dataDescription cannot be empty');

  logger.info(`Creating auction: "${dataDescription}"`, {
    minBid: minimumContribution + ' wei',
    duration: auctionDuration + ' min',
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
    mode: simulate ? 'SIMULATE' : 'LIVE',
  });

  if (simulate) {
<<<<<<< HEAD
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
=======
    logger.info(`  [SIMULATE] Would call factory.createCampaign(${minimumContribution}, "${dataForSell}", "${dataDescription}", ${auctionDuration}) — skipping`);
    return { simulated: true };
  }

  // Estimate gas
  const gas = await factory.methods
    .createCampaign(minimumContribution, dataForSell, dataDescription, auctionDuration)
    .estimateGas({ from: account.address });

  const receipt = await factory.methods
    .createCampaign(minimumContribution, dataForSell, dataDescription, auctionDuration)
    .send({
      from: account.address,
      gas: Math.ceil(Number(gas) * 1.2),
    });

  // The AuctionCreated event emits the new campaign address
  const newAddress = receipt.events?.AuctionCreated?.returnValues?.campaignAddress;
  logger.info(`  ✅ Auction created!`, {
    tx: receipt.transactionHash,
    newCampaign: newAddress,
  });

  return { receipt, newAddress };
}

/**
 * Batch-create auctions from a JSON config file.
 */
async function createAuctionsFromConfig(configPath = './data/sell-list.json') {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    logger.error(`Sell config not found: ${resolved}`);
    logger.info(`Create it at ${resolved} — see data/sell-list.example.json`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
    return [];
  }

  const items = JSON.parse(fs.readFileSync(resolved, 'utf8'));
<<<<<<< HEAD
  logger.info(`Batch creating ${items.length} auction(s)...`);
=======
  logger.info(`Creating ${items.length} auction(s) from ${resolved}`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a

  const results = [];
  for (const item of items) {
    try {
<<<<<<< HEAD
      const r = await createAuction(item);
      results.push({ item, success: true, ...r });
    } catch (err) {
      logger.error(`Failed: "${item.dataDescription}"`, { error: err.message });
      results.push({ item, success: false, error: err.message });
    }
    await sleep(3000);
  }
=======
      const result = await createAuction(item);
      results.push({ item, success: true, ...result });
    } catch (err) {
      logger.error(`Failed to create auction: ${item.dataDescription}`, { error: err.message });
      results.push({ item, success: false, error: err.message });
    }
    await sleep(3000); // avoid nonce collisions
  }

>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
  return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { createAuction, createAuctionsFromConfig };
