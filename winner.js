// winner.js — retrieve won data, export CSVs, track refunds
const { getCampaign, getAccount, unwrapError } = require('./chain');
const { fetchAllAuctions } = require('./auctions');
const logger = require('./logger');
const fs   = require('fs');
const path = require('path');

async function processClosedAuctions() {
  const me = getAccount().address.toLowerCase();
  const auctions = await fetchAllAuctions();
  const closed   = auctions.filter(a => !a.isActive);
  logger.info(`\nProcessing ${closed.length} closed auction(s)...`);

  const results = { won: [], sold: [], refunded: [], awaitingRefund: [] };

  for (const a of closed) {
    if (a.isWinner)       await _handleWin(a, results);
    else if (a.isManager) await _handleSold(a, results);
    else if (a.amIBidding) await _handleLoss(a, results);
  }

  logger.info(`\nWinner Report: won=${results.won.length} sold=${results.sold.length} refunded=${results.refunded.length} pending=${results.awaitingRefund.length}\n`);
  return results;
}

async function _handleWin(a, results) {
  logger.info(`🏆 WON: "${a.dataDescription}" [${a.address}]`);
  try {
    const campaign = getCampaign(a.address);
    const account  = getAccount();
    if (a.closed) {
      const data = await campaign.methods.getData().call({ from: account.address });
      logger.info(`   Data: ${data}`);
      _saveWonData(a, data);
      results.won.push({ address: a.address, description: a.dataDescription, data });
    } else {
      logger.info(`   ⏳ Not yet finalized — manager must call finalizeAuctionIfNeeded()`);
      results.won.push({ address: a.address, description: a.dataDescription, data: null, pending: true });
    }
  } catch (err) {
    logger.warn(`   Could not retrieve data: ${unwrapError(err)}`);
    results.won.push({ address: a.address, description: a.dataDescription, error: unwrapError(err) });
  }
}

async function _handleSold(a, results) {
  logger.info(`💰 SOLD: "${a.dataDescription}" — ${a.highestBid} wei`);
  try {
    const campaign = getCampaign(a.address);
    const rawTxs   = await campaign.methods.getTransactions().call();
    if (rawTxs.length > 0) {
      const f = _exportCSV(a, rawTxs);
      logger.info(`   CSV: ${f}`);
    }
  } catch (_) {}
  results.sold.push({ address: a.address, description: a.dataDescription, earned: a.highestBid.toString(), finalized: a.closed });
}

async function _handleLoss(a, results) {
  logger.info(`↩️  LOST: "${a.dataDescription}" — bid: ${a.myBid} wei`);
  const campaign = getCampaign(a.address);
  const account  = getAccount();
  try {
    const bal = await campaign.methods.getBid(account.address).call();
    if (BigInt(bal) === 0n) {
      logger.info(`   ✅ Refunded`);
      results.refunded.push({ address: a.address });
    } else {
      logger.info(`   ⏳ Awaiting refund: ${bal} wei`);
      results.awaitingRefund.push({ address: a.address, amount: bal.toString() });
    }
  } catch (_) {
    results.awaitingRefund.push({ address: a.address, amount: a.myBid.toString() });
  }
}

function _saveWonData(a, data) {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, `won-${a.address.slice(0,10)}-${Date.now()}.txt`);
  fs.writeFileSync(file, `Auction: ${a.address}\nDescription: ${a.dataDescription}\nWon: ${new Date().toISOString()}\n\nDATA:\n${data}`, 'utf8');
  logger.info(`   Saved: ${file}`);
}

function _exportCSV(a, rawTxs) {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const rows = rawTxs.map(tx =>
    [
      `"${tx.bidderAddress}"`,
      `"${tx.value}"`,
      `"${new Date(Number(tx.time)*1000).toISOString()}"`,
    ].join(',')
  );
  const csv  = ['bidder,bid,time', ...rows].join('\n');
  const file = path.join(logsDir, `txs-${a.address.slice(0,10)}-${Date.now()}.csv`);
  fs.writeFileSync(file, csv, 'utf8');
  return file;
}

module.exports = { processClosedAuctions };
