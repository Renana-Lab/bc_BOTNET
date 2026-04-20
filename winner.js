<<<<<<< HEAD
// winner.js — retrieve won data, export CSVs, track refunds
const { getCampaign, getAccount, unwrapError } = require('./chain');
const { fetchAllAuctions } = require('./auctions');
const logger = require('./logger');
const fs   = require('fs');
const path = require('path');

=======
// src/winner.js
// Handles post-auction winner actions:
//   1. Retrieve the secret data from won auctions  (campaign.getData())
//   2. Export bidding history to CSV               (mirrors ShowAuctionPage.js downloadCSV)
//   3. Check for auctions where you need a refund

const { getCampaign, getAccount, getWeb3 } = require('./chain');
const { fetchAllAuctions } = require('./auctions');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

/**
 * Check all closed auctions and:
 *  - retrieve won data (if you are the winner)
 *  - export bidding history CSV (if you are the manager)
 *  - report refund status (if you participated and lost)
 */
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
async function processClosedAuctions() {
  const me = getAccount().address.toLowerCase();
  const auctions = await fetchAllAuctions();
  const closed   = auctions.filter(a => !a.isActive);
<<<<<<< HEAD
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
=======

  logger.info(`\n📬 Processing ${closed.length} closed auction(s)...`);

  const results = { won: [], sold: [], refunded: [], awaitingRefund: [] };

  for (const auction of closed) {
    if (auction.isWinner) {
      await _handleWin(auction, results);
    } else if (auction.isManager) {
      await _handleSold(auction, results);
    } else if (auction.amIBidding) {
      await _handleLoss(auction, results);
    }
  }

  _printSummary(results);
  return results;
}

async function _handleWin(auction, results) {
  logger.info(`\n🏆 WON: "${auction.dataDescription}" [${auction.address}]`);

  try {
    const campaign = getCampaign(auction.address);
    const account  = getAccount();

    // getData() only works for the winner after finalization
    if (auction.closed) {
      const data = await campaign.methods.getData().call({ from: account.address });
      logger.info(`   ✅ Data retrieved: ${data}`);
      results.won.push({ address: auction.address, description: auction.dataDescription, data });

      // Save to file
      _saveWonData(auction, data);
    } else {
      logger.info(`   ⏳ Auction not yet finalized — manager needs to call finalizeAuctionIfNeeded()`);
      results.won.push({ address: auction.address, description: auction.dataDescription, data: null, pending: true });
    }
  } catch (err) {
    logger.warn(`   Could not retrieve data: ${err.message}`);
    results.won.push({ address: auction.address, description: auction.dataDescription, error: err.message });
  }
}

async function _handleSold(auction, results) {
  const earned = auction.highestBid;
  logger.info(`\n💰 SOLD: "${auction.dataDescription}" — earned ${earned} wei`);

  if (!auction.closed && auction.approversCount > 0) {
    logger.info(`   ⚠️  Not yet finalized — run: npm run buy (or auto mode) to call finalizeAuctionIfNeeded()`);
  }

  // Export bidding history to CSV
  try {
    const campaign = getCampaign(auction.address);
    const rawTxs   = await campaign.methods.getTransactions().call();

    if (rawTxs.length > 0) {
      const csvPath = _exportTransactionsCSV(auction, rawTxs);
      logger.info(`   📄 Bidding history exported to: ${csvPath}`);
    }
  } catch (err) {
    logger.warn(`   Could not export transactions: ${err.message}`);
  }

  results.sold.push({ address: auction.address, description: auction.dataDescription, earned: earned.toString(), finalized: auction.closed });
}

async function _handleLoss(auction, results) {
  const myBid = auction.myBid;
  logger.info(`\n↩️  LOST: "${auction.dataDescription}" — your bid: ${myBid} wei`);

  if (auction.closed) {
    // Auction finalized — check if our bid was refunded (balance should be 0)
    const campaign = getCampaign(auction.address);
    const balance  = await campaign.methods.getBid(getAccount().address).call();
    if (BigInt(balance) === 0n) {
      logger.info(`   ✅ Refund confirmed`);
      results.refunded.push({ address: auction.address, description: auction.dataDescription });
    } else {
      logger.info(`   ⏳ Refund pending — ${balance} wei still in contract`);
      results.awaitingRefund.push({ address: auction.address, description: auction.dataDescription, amount: balance.toString() });
    }
  } else {
    logger.info(`   ⏳ Awaiting manager to finalize and issue refund`);
    results.awaitingRefund.push({ address: auction.address, description: auction.dataDescription, amount: myBid.toString() });
  }
}

/**
 * Save won data to a timestamped file in ./logs/
 */
function _saveWonData(auction, data) {
  const logsDir = path.resolve('./logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const filename = `won-data-${auction.address.slice(0, 10)}-${Date.now()}.txt`;
  const filePath = path.join(logsDir, filename);
  const content = [
    `Auction:     ${auction.address}`,
    `Description: ${auction.dataDescription}`,
    `Won at:      ${new Date().toISOString()}`,
    ``,
    `DATA:`,
    data,
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf8');
  logger.info(`   💾 Saved to: ${filePath}`);
}

/**
 * Export bidding history to CSV — mirrors transactionsToCSV() in ShowAuctionPage.js
 */
function _exportTransactionsCSV(auction, rawTxs) {
  const logsDir = path.resolve('./logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const rows = rawTxs.map(tx => {
    const timeMs = Number(tx.time) * 1000;
    const timeStr = new Date(timeMs).toISOString();
    return [
      `"${tx.bidderAddress}"`,
      `"${tx.value}"`,
      `"${timeStr}"`,
    ].join(',');
  });

  const csv = ['bidder,bid,time', ...rows].join('\n');
  const filename = `transactions-${auction.address.slice(0, 10)}-${Date.now()}.csv`;
  const filePath = path.join(logsDir, filename);
  fs.writeFileSync(filePath, csv, 'utf8');
  return filePath;
}

function _printSummary(results) {
  logger.info(`\n${'─'.repeat(60)}`);
  logger.info(`Winner Report:`);
  logger.info(`  🏆 Auctions won:           ${results.won.length}`);
  logger.info(`  💰 Auctions sold:           ${results.sold.length}`);
  logger.info(`  ✅ Refunds confirmed:       ${results.refunded.length}`);
  logger.info(`  ⏳ Refunds pending:         ${results.awaitingRefund.length}`);
  logger.info(`${'─'.repeat(60)}\n`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
}

module.exports = { processClosedAuctions };
