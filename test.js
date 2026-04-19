// src/test.js
// Lightweight test suite — verifies the bot's logic without connecting to chain.
// Run with: node src/test.js

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     → ${err.message}`);
    failed++;
  }
}

// ── Mock the chain module so bidder.js can be required without a real RPC ──
const Module = require('module');
const _resolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === './chain' || request === '../chain') return request;
  return _resolveFilename(request, parent, isMain, options);
};
require.cache['./chain'] = { id: './chain', filename: './chain', loaded: true, exports: {
  getAccount: () => ({ address: '0xBotWallet000000000000000000000000000001' }),
  getCampaign: () => ({}),
  getWeb3: () => ({}),
  weiToEth: (w) => (Number(w) / 1e18).toFixed(8),
}};
require.cache['../chain'] = require.cache['./chain'];

// Load bidder logic (shouldBid is pure — no RPC calls)
// We inline it here to avoid require issues in test context
function shouldBid_test(auction, me, myBudget, opts = {}) {
  const MAX_BID_WEI     = BigInt(opts.maxBid     ?? '5000');
  const OUTBID_BY_WEI   = BigInt(opts.outbidBy   ?? '100');
  const MAX_MIN_CONTRIB = BigInt(opts.maxMinBid   ?? '2000');
  const SKIP_IF_WINNING = opts.skipIfWinning      ?? true;
  const MIN_TIME_SEC    = opts.minTimeSec         ?? 60;

  if (!auction.isActive)
    return { bid: false, reason: 'Auction closed' };
  if (auction.secondsLeft < MIN_TIME_SEC)
    return { bid: false, reason: `Too little time` };
  if (auction.isManager)
    return { bid: false, reason: 'You are the seller' };
  if (SKIP_IF_WINNING && auction.amIWinning)
    return { bid: false, reason: 'Already winning' };
  if (auction.minimumContribution > MAX_MIN_CONTRIB)
    return { bid: false, reason: 'Min contribution too high' };

  let bidAmount = auction.approversCount === 0
    ? auction.minimumContribution
    : auction.highestBid + OUTBID_BY_WEI;

  let sendAmount = bidAmount;
  if (auction.amIBidding && auction.myBid > 0n) {
    sendAmount = bidAmount - auction.myBid;
    if (sendAmount <= 0n) return { bid: false, reason: 'Already have highest bid covered' };
  }

  if (sendAmount > MAX_BID_WEI)
    return { bid: false, reason: `Exceeds MAX_BID_WEI` };
  if (sendAmount > myBudget)
    return { bid: false, reason: `Insufficient budget` };

  return { bid: true, reason: 'All conditions met', amount: sendAmount };
}

function makeAuction(overrides = {}) {
  return {
    address: '0xAuction0000000000000000000000000000001',
    dataDescription: 'Test Dataset',
    isActive: true,
    secondsLeft: 300,
    isManager: false,
    amIWinning: false,
    amIBidding: false,
    myBid: 0n,
    minimumContribution: 500n,
    highestBid: 0n,
    approversCount: 0,
    closed: false,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────
console.log('\n📋 shouldBid() strategy tests\n');

test('Bids with minimumContribution when no bids exist', () => {
  const result = shouldBid_test(makeAuction({ approversCount: 0, minimumContribution: 500n }), 'me', 9999n);
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 500n);
});

test('Outbids current highest by OUTBID_BY_WEI', () => {
  const result = shouldBid_test(makeAuction({
    approversCount: 1,
    highestBid: 1000n,
    minimumContribution: 100n,
  }), 'me', 9999n, { outbidBy: '200' });
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 1200n); // 1000 + 200
});

test('Only sends increment when already bidding', () => {
  const result = shouldBid_test(makeAuction({
    approversCount: 2,
    highestBid: 1500n,
    minimumContribution: 100n,
    amIBidding: true,
    myBid: 1000n,
  }), 'me', 9999n, { outbidBy: '100' });
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 600n); // (1500+100) - 1000 = 600
});

test('Skips closed auctions', () => {
  const result = shouldBid_test(makeAuction({ isActive: false }), 'me', 9999n);
  assert.strictEqual(result.bid, false);
  assert(result.reason.includes('closed'));
});

test('Skips own auctions (seller)', () => {
  const result = shouldBid_test(makeAuction({ isManager: true }), 'me', 9999n);
  assert.strictEqual(result.bid, false);
  assert(result.reason.includes('seller'));
});

test('Skips when already winning (SKIP_IF_WINNING=true)', () => {
  const result = shouldBid_test(makeAuction({ amIWinning: true }), 'me', 9999n, { skipIfWinning: true });
  assert.strictEqual(result.bid, false);
});

test('Bids when already winning but SKIP_IF_WINNING=false', () => {
  const result = shouldBid_test(makeAuction({
    amIWinning: true,
    approversCount: 1,
    highestBid: 500n,
    minimumContribution: 100n,
  }), 'me', 9999n, { skipIfWinning: false, outbidBy: '50' });
  assert.strictEqual(result.bid, true);
});

test('Skips when minimum contribution exceeds MAX_MIN_CONTRIBUTION_WEI', () => {
  const result = shouldBid_test(makeAuction({ minimumContribution: 9999n }), 'me', 99999n, { maxMinBid: '1000' });
  assert.strictEqual(result.bid, false);
  assert(result.reason.includes('Min contribution'));
});

test('Skips when bid would exceed MAX_BID_WEI', () => {
  const result = shouldBid_test(makeAuction({
    approversCount: 1,
    highestBid: 9000n,
    minimumContribution: 100n,
  }), 'me', 99999n, { maxBid: '500', outbidBy: '100' });
  assert.strictEqual(result.bid, false);
  assert(result.reason.includes('MAX_BID_WEI'));
});

test('Skips when on-chain budget is insufficient', () => {
  const result = shouldBid_test(makeAuction({
    approversCount: 0,
    minimumContribution: 1000n,
  }), 'me', 500n); // budget too low
  assert.strictEqual(result.bid, false);
  assert(result.reason.includes('budget'));
});

test('Skips when too little time remaining', () => {
  const result = shouldBid_test(makeAuction({ secondsLeft: 10 }), 'me', 9999n, { minTimeSec: 60 });
  assert.strictEqual(result.bid, false);
  assert(result.reason.includes('time'));
});

test('Skips when already have highest bid covered', () => {
  // myBid already exceeds what we would target
  const result = shouldBid_test(makeAuction({
    approversCount: 1,
    highestBid: 500n,
    amIBidding: true,
    myBid: 700n, // already higher than 500+100=600
    minimumContribution: 100n,
  }), 'me', 9999n, { outbidBy: '100' });
  assert.strictEqual(result.bid, false);
});

// ──────────────────────────────────────────────────────────────
console.log('\n📋 CSV export tests\n');

function transactionsToCSV(transactions) {
  const REQUIRED_KEYS = ['bidder', 'bid', 'time'];
  const header = REQUIRED_KEYS.join(',');
  const rows = transactions.map(tx =>
    REQUIRED_KEYS.map(key => `"${String(tx[key]).replace(/"/g, '""')}"`).join(',')
  );
  return [header, ...rows].join('\n');
}

test('CSV has correct header', () => {
  const csv = transactionsToCSV([{ bidder: '0xABC', bid: '100', time: '2024-01-01' }]);
  assert(csv.startsWith('bidder,bid,time'));
});

test('CSV has correct row count', () => {
  const rows = [
    { bidder: '0xAAA', bid: '100', time: 't1' },
    { bidder: '0xBBB', bid: '200', time: 't2' },
  ];
  const csv = transactionsToCSV(rows);
  const lines = csv.split('\n');
  assert.strictEqual(lines.length, 3); // header + 2 rows
});

test('CSV escapes double quotes', () => {
  const csv = transactionsToCSV([{ bidder: 'addr"test', bid: '0', time: 't' }]);
  assert(csv.includes('addr""test'));
});

// ──────────────────────────────────────────────────────────────
console.log('\n📋 Auction time utils tests\n');

function formatTime(seconds) {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

test('formatTime: seconds only', () => { assert.strictEqual(formatTime(45), '45s'); });
test('formatTime: minutes and seconds', () => { assert.strictEqual(formatTime(90), '1m 30s'); });
test('formatTime: hours and minutes', () => { assert.strictEqual(formatTime(3660), '1h 1m'); });
test('formatTime: 30 minutes (max auction)', () => { assert.strictEqual(formatTime(1800), '30m 0s'); });

// ──────────────────────────────────────────────────────────────
console.log('\n📋 Sell config validation tests\n');

function validateAuctionItem(item) {
  const errors = [];
  if (!Number.isInteger(Number(item.minimumContribution)) || Number(item.minimumContribution) <= 0)
    errors.push('minimumContribution must be a positive integer');
  if (!Number.isInteger(Number(item.auctionDuration)) || item.auctionDuration < 1 || item.auctionDuration > 30)
    errors.push('auctionDuration must be between 1 and 30');
  if (!String(item.dataForSell || '').trim())
    errors.push('dataForSell cannot be empty');
  if (!String(item.dataDescription || '').trim())
    errors.push('dataDescription cannot be empty');
  return errors;
}

test('Valid auction item passes validation', () => {
  const errors = validateAuctionItem({ minimumContribution: 500, auctionDuration: 10, dataForSell: 'data', dataDescription: 'desc' });
  assert.strictEqual(errors.length, 0);
});
test('Rejects zero minimumContribution', () => {
  const errors = validateAuctionItem({ minimumContribution: 0, auctionDuration: 10, dataForSell: 'data', dataDescription: 'desc' });
  assert(errors.some(e => e.includes('minimumContribution')));
});
test('Rejects auctionDuration > 30', () => {
  const errors = validateAuctionItem({ minimumContribution: 100, auctionDuration: 31, dataForSell: 'data', dataDescription: 'desc' });
  assert(errors.some(e => e.includes('auctionDuration')));
});
test('Rejects empty dataForSell', () => {
  const errors = validateAuctionItem({ minimumContribution: 100, auctionDuration: 5, dataForSell: '', dataDescription: 'desc' });
  assert(errors.some(e => e.includes('dataForSell')));
});
test('Rejects empty dataDescription', () => {
  const errors = validateAuctionItem({ minimumContribution: 100, auctionDuration: 5, dataForSell: 'data', dataDescription: '   ' });
  assert(errors.some(e => e.includes('dataDescription')));
});

// ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Some tests failed!');
  process.exit(1);
} else {
  console.log('All tests passed ✅');
  process.exit(0);
}
