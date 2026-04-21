const { getCampaign, getAccount, unwrapError } = require('./chain');
const { fetchAllAuctions } = require('./auctions');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

async function processClosedAuctions() {
  const auctions = await fetchAllAuctions();
  const closed = auctions.filter((a) => !a.isActive);
  const results = { won: [], sold: [], refunded: [], awaitingRefund: [] };

  logger.info(`Processing ${closed.length} closed auction(s)`);

  for (const auction of closed) {
    if (auction.isWinner) {
      await handleWin(auction, results);
    } else if (auction.isManager) {
      await handleSold(auction, results);
    } else if (auction.amIBidding) {
      await handleLoss(auction, results);
    }
  }

  logger.info(`Winner report: won=${results.won.length} sold=${results.sold.length} refunded=${results.refunded.length} pending=${results.awaitingRefund.length}`);
  return results;
}

async function handleWin(auction, results) {
  logger.info(`Won auction "${auction.dataDescription}"`);
  try {
    const campaign = getCampaign(auction.address);
    const account = getAccount();
    if (auction.closed) {
      const data = await campaign.methods.getData().call({ from: account.address });
      saveWonData(auction, data);
      results.won.push({ address: auction.address, description: auction.dataDescription, data });
    } else {
      results.won.push({ address: auction.address, description: auction.dataDescription, data: null, pending: true });
    }
  } catch (err) {
    results.won.push({
      address: auction.address,
      description: auction.dataDescription,
      error: unwrapError(err),
    });
  }
}

async function handleSold(auction, results) {
  logger.info(`Sold auction "${auction.dataDescription}" for ${auction.highestBid} wei`);
  try {
    const campaign = getCampaign(auction.address);
    const rawTxs = await campaign.methods.getTransactions().call();
    if (rawTxs.length > 0) {
      exportCSV(auction, rawTxs);
    }
  } catch (_) {}
  results.sold.push({
    address: auction.address,
    description: auction.dataDescription,
    earned: auction.highestBid.toString(),
    finalized: auction.closed,
  });
}

async function handleLoss(auction, results) {
  const campaign = getCampaign(auction.address);
  const account = getAccount();
  try {
    const balance = await campaign.methods.getBid(account.address).call();
    if (BigInt(balance) === 0n) {
      results.refunded.push({ address: auction.address, description: auction.dataDescription });
    } else {
      results.awaitingRefund.push({ address: auction.address, description: auction.dataDescription, amount: String(balance) });
    }
  } catch (_) {
    results.awaitingRefund.push({ address: auction.address, description: auction.dataDescription, amount: auction.myBid.toString() });
  }
}

function saveWonData(auction, data) {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, `won-${auction.address.slice(0, 10)}-${Date.now()}.txt`);
  fs.writeFileSync(file, `Auction: ${auction.address}\nDescription: ${auction.dataDescription}\n\n${data}`, 'utf8');
}

function exportCSV(auction, rawTxs) {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const rows = rawTxs.map((tx) => `"${tx.bidderAddress}","${tx.value}","${new Date(Number(tx.time) * 1000).toISOString()}"`);
  const csv = ['bidder,bid,time', ...rows].join('\n');
  const file = path.join(logsDir, `txs-${auction.address.slice(0, 10)}-${Date.now()}.csv`);
  fs.writeFileSync(file, csv, 'utf8');
  return file;
}

module.exports = { processClosedAuctions };
