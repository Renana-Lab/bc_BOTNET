const {
  getFactory,
  getAccount,
  buildTxParams,
  resyncNonce,
  retryRpc,
  sendContractTransaction,
  unwrapError,
} = require('../chain');
const logger = require('../config/logger');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../paths');

const GENERATED_CATALOG = [
  {
    theme: 'Wallet behavior bundle',
    descriptions: [
      'Cross-wallet behavioral signals for active marketplace traders',
      'Wallet engagement clusters with purchase-intent scoring',
      'Bid-response timing fingerprints across recent data buyers',
    ],
    payloads: [
      'ipfs://generated/wallet-behavior-pack-a.json',
      'ipfs://generated/wallet-engagement-clusters-b.json',
      'ipfs://generated/bid-timing-fingerprints-c.json',
    ],
    minBidRange: [180, 420],
    durationRange: [5, 12],
  },
  {
    theme: 'Consumer intelligence feed',
    descriptions: [
      'Fresh browsing-intent segments for high-spend crypto consumers',
      'Category-level shopping propensity feed with confidence labels',
      'Marketplace demand heatmap for niche digital goods buyers',
    ],
    payloads: [
      'ipfs://generated/consumer-intel-feed-a.csv',
      'ipfs://generated/shopping-propensity-feed-b.csv',
      'ipfs://generated/demand-heatmap-c.csv',
    ],
    minBidRange: [220, 560],
    durationRange: [6, 15],
  },
  {
    theme: 'Synthetic identity graph',
    descriptions: [
      'Synthetic profile graph linking wallets, devices, and browsing cohorts',
      'Identity-resolution sample pack with confidence-weighted edges',
      'Audience graph snapshot for retargeting experiments on Sepolia',
    ],
    payloads: [
      'ipfs://generated/identity-graph-a.parquet',
      'ipfs://generated/resolution-edges-b.parquet',
      'ipfs://generated/audience-graph-c.parquet',
    ],
    minBidRange: [300, 800],
    durationRange: [8, 18],
  },
];

async function createAuction(item) {
  const simulate = process.env.BOT_MODE === 'simulate';
  const factory = getFactory();
  const account = getAccount();
  const { minimumContribution, dataForSell, dataDescription, auctionDuration } = item;

  if (!Number.isInteger(Number(minimumContribution)) || Number(minimumContribution) <= 0) {
    throw new Error(`minimumContribution must be a positive integer (got: ${minimumContribution})`);
  }
  if (!Number.isInteger(Number(auctionDuration)) || Number(auctionDuration) < 1 || Number(auctionDuration) > 30) {
    throw new Error(`auctionDuration must be between 1 and 30 minutes (got: ${auctionDuration})`);
  }
  if (!String(dataForSell || '').trim()) throw new Error('dataForSell cannot be empty');
  if (!String(dataDescription || '').trim()) throw new Error('dataDescription cannot be empty');

  logger.ascii('creating auction', [
    `min bid ${String(minimumContribution)} wei`,
    `length  ${String(auctionDuration)} min`,
  ], {
    message: `Creating auction "${dataDescription}"`,
    minBidWei: String(minimumContribution),
    durationMin: String(auctionDuration),
    mode: simulate ? 'SIMULATE' : 'LIVE',
  });

  if (simulate) {
    return { simulated: true };
  }

  try {
    const args = [
      String(minimumContribution),
      String(dataForSell),
      String(dataDescription),
      String(auctionDuration),
    ];
    let gas;
    try {
      gas = await retryRpc(() => factory.methods.createCampaign(...args).estimateGas({ from: account.address }), 4, 800);
    } catch (estimateErr) {
      logger.warn(`Gas estimate failed for "${dataDescription}", using fallback gas`, { error: unwrapError(estimateErr) });
      gas = 2500000;
    }
    const gasLimit = Math.ceil(Number(gas) * 1.2).toString();
    let receipt;
    try {
      const txParams = await buildTxParams({ to: factory.options.address, gas: gasLimit });
      const sendResult = await retryRpc(
        () => sendContractTransaction(
          factory.methods.createCampaign(...args),
          txParams,
          { action: 'createAuction', description: dataDescription }
        ),
        2,
        1000
      );
      receipt = await retryRpc(() => getWeb3().eth.getTransactionReceipt(sendResult.transactionHash), 5, 2000);
    } catch (sendErr) {
      logger.warn(`Create send failed for "${dataDescription}", retrying once after nonce resync`, { error: unwrapError(sendErr) });
      await resyncNonce();
      const retryTxParams = await buildTxParams({ to: factory.options.address, gas: gasLimit });
      const retrySendResult = await retryRpc(
        () => sendContractTransaction(
          factory.methods.createCampaign(...args),
          retryTxParams,
          { action: 'createAuctionRetry', description: dataDescription }
        ),
        2,
        1200
      );
      receipt = await retryRpc(() => getWeb3().eth.getTransactionReceipt(retrySendResult.transactionHash), 5, 2000);
    }
    const newAddress = receipt.events?.AuctionCreated?.returnValues?.campaignAddress;
    return { receipt, newAddress };
  } catch (err) {
    await resyncNonce();
    throw new Error(unwrapError(err));
  }
}

async function createAuctionsFromConfig(configPath, options = {}) {
  const desiredCount = Number(options.countOverride || process.env.AUTO_GENERATE_COUNT || '2');
  const allowedCount = await getAllowedCreationCount(desiredCount, options.auctions);
  if (allowedCount <= 0) {
    logger.info('Sell creation skipped because the max total sell auction cap has been reached');
    return [];
  }
  const resolved = configPath
    ? path.resolve(configPath)
    : path.join(dataDir, 'sell-list.json');

  if (!fs.existsSync(resolved)) {
    logger.warn(`Sell config not found: ${resolved}`);
    return createAutoGeneratedAuctions(
      allowedCount,
      { force: options.forceGenerated === true }
    );
  }

  const items = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!Array.isArray(items) || items.length === 0) {
    return createAutoGeneratedAuctions(
      allowedCount,
      { force: options.forceGenerated === true }
    );
  }
  const cappedItems = items.slice(0, allowedCount);
  logger.info(`Creating ${cappedItems.length} auction(s) from ${resolved}`);

  const results = [];
  for (const item of cappedItems) {
    try {
      const result = await createAuction(item);
      results.push({ item, success: true, ...result });
    } catch (err) {
      logger.error(`Failed to create auction "${item.dataDescription}"`, { error: err.message });
      results.push({ item, success: false, error: err.message });
    }
    await sleep(2000);
  }

  return results;
}

async function createAutoGeneratedAuctions(
  count = Number(process.env.AUTO_GENERATE_COUNT || '2'),
  options = {}
) {
  if (process.env.AUTO_GENERATE_AUCTIONS === 'false' && options.force !== true) {
    logger.info('Auto-generated auctions are disabled');
    return [];
  }

  const allowedCount = await getAllowedCreationCount(count, options.auctions);
  if (allowedCount <= 0) {
    logger.info('Auto-generation skipped because the max total sell auction cap has been reached');
    return [];
  }

  const items = Array.from({ length: Math.max(1, allowedCount) }, (_, index) => buildGeneratedAuction(index));
  logger.info(`Auto-generating ${items.length} auction idea(s)`);

  const results = [];
  for (const item of items) {
    try {
      const result = await createAuction(item);
      results.push({ item, success: true, generated: true, ...result });
    } catch (err) {
      logger.error(`Failed to create generated auction "${item.dataDescription}"`, { error: err.message });
      results.push({ item, success: false, generated: true, error: err.message });
    }
    await sleep(2000);
  }

  return results;
}

async function maintainAuctionInventory(auctions = []) {
  if (process.env.ENABLE_SELLING !== 'true') {
    return [];
  }

  if (process.env.AUTO_GENERATE_AUCTIONS === 'false') {
    logger.info('Generated sell inventory disabled; scheduled auctions can still launch when due');
    return [];
  }

  const target = Math.max(0, Number(process.env.TARGET_ACTIVE_SELL_AUCTIONS || '2'));
  const myOpenAuctions = auctions.filter((auction) => auction.isActive && auction.isManager);
  const remainingAllowance = getRemainingAuctionAllowance(auctions);
  const missing = Math.max(0, target - myOpenAuctions.length);

  if (missing === 0) {
    logger.info(`Auction inventory healthy (${myOpenAuctions.length}/${target} active listings)`);
    return [];
  }

  if (remainingAllowance <= 0) {
    logger.info(`Inventory cap reached (${countMyAuctions(auctions)}/${getMaxTotalSellAuctions()} total bot auctions); skipping new listings`);
    return [];
  }

  const toCreate = Math.min(missing, remainingAllowance);
  logger.info(`Maintaining inventory: creating ${toCreate} auction(s) to reach target ${target}`);
  return createAutoGeneratedAuctions(toCreate, { force: true, auctions });
}

async function seedAuctionInventory(count = Number(process.env.TARGET_ACTIVE_SELL_AUCTIONS || '2'), auctions = null) {
  const safeCount = Math.max(1, Number(count || 1));
  const allowedCount = await getAllowedCreationCount(safeCount, auctions);
  if (allowedCount <= 0) {
    logger.info(`Sell seed skipped because the max total sell auction cap (${getMaxTotalSellAuctions()}) has been reached`);
    return [];
  }
  logger.info(`Seeding sell inventory with ${allowedCount} generated auction(s)`);
  return createAutoGeneratedAuctions(allowedCount, { force: true, auctions });
}

function buildGeneratedAuction(index = 0) {
  const slot = GENERATED_CATALOG[index % GENERATED_CATALOG.length];
  const desc = slot.descriptions[randomInt(0, slot.descriptions.length - 1)];
  const payload = slot.payloads[randomInt(0, slot.payloads.length - 1)];
  const minimumContribution = randomInt(slot.minBidRange[0], slot.minBidRange[1]);
  const auctionDuration = randomInt(slot.durationRange[0], slot.durationRange[1]);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

  return {
    minimumContribution,
    dataForSell: `${payload} | generated-at=${stamp} | theme=${slot.theme}`,
    dataDescription: `${desc} | ${slot.theme}`,
    auctionDuration,
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAllowedCreationCount(requestedCount, auctions = null) {
  const desired = Math.max(0, Number(requestedCount || 0));
  if (desired === 0) {
    return 0;
  }

  const snapshot = Array.isArray(auctions) ? auctions : await loadCurrentAuctions();
  const remainingAllowance = getRemainingAuctionAllowance(snapshot);
  return Math.max(0, Math.min(desired, remainingAllowance));
}

function getRemainingAuctionAllowance(auctions = []) {
  const maxTotal = getMaxTotalSellAuctions();
  if (!Number.isFinite(maxTotal)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(0, maxTotal - countMyAuctions(auctions));
}

function countMyAuctions(auctions = []) {
  return auctions.filter((auction) => auction.isManager).length;
}

function getMaxTotalSellAuctions() {
  const raw = Number(process.env.MAX_TOTAL_SELL_AUCTIONS || '10');
  if (!Number.isFinite(raw) || raw < 0) {
    return 10;
  }
  return raw;
}

async function loadCurrentAuctions() {
  try {
    const { fetchAllAuctions } = require('./auctions');
    return await fetchAllAuctions();
  } catch (_) {
    return [];
  }
}

module.exports = { createAuction, createAuctionsFromConfig, createAutoGeneratedAuctions, maintainAuctionInventory, seedAuctionInventory };
