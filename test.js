const assert = require('assert');
const { shouldBid } = require('./bidder');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
    passed++;
  } catch (err) {
    console.error(`  fail ${name}: ${err.message}`);
    failed++;
  }
}

function auction(overrides = {}) {
  return {
    address: '0xA',
    dataDescription: 'Test',
    isActive: true,
    secondsLeft: 300,
    isManager: false,
    amIWinning: false,
    amIBidding: false,
    myBid: 0n,
    minimumContribution: 500n,
    highestBid: 0n,
    approversCount: 0,
    bidderAddresses: [],
    closed: false,
    ...overrides,
  };
}

const strategy = {
  profile: 'balanced',
  MAX_BID_WEI: 5000n,
  OUTBID_BY_WEI: 100n,
  MAX_MIN_CONTRIB: 2000n,
  SKIP_IF_WINNING: true,
  MIN_TIME_SEC: 60,
};

console.log('\nshouldBid() tests\n');

test('bids minimum contribution when empty', () => {
  const result = shouldBid(auction(), 9999n, strategy);
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 500n);
});

test('outbids current highest', () => {
  const result = shouldBid(auction({ approversCount: 1, highestBid: 1000n, minimumContribution: 100n }), 9999n, strategy);
  assert.strictEqual(result.amount, 1100n);
});

test('sends only increment when already bidding', () => {
  const result = shouldBid(
    auction({
      approversCount: 2,
      bidderAddresses: ['0xme', '0xother'],
      highestBid: 1500n,
      minimumContribution: 100n,
      amIBidding: true,
      myBid: 1000n,
    }),
    9999n,
    strategy
  );
  assert.strictEqual(result.amount, 600n);
});

test('skips topping up when already sole bidder', () => {
  const result = shouldBid(
    auction({
      approversCount: 1,
      bidderAddresses: ['0xme'],
      highestBid: 300n,
      minimumContribution: 100n,
      amIBidding: true,
      myBid: 300n,
      amIWinning: false,
    }),
    9999n,
    strategy
  );
  assert.strictEqual(result.bid, false);
  assert.strictEqual(result.reason, 'Already leading without competition');
});

test('still bids again when another bidder exists', () => {
  const result = shouldBid(
    auction({
      approversCount: 2,
      bidderAddresses: ['0xme', '0xother'],
      highestBid: 400n,
      minimumContribution: 100n,
      amIBidding: true,
      myBid: 300n,
      amIWinning: false,
    }),
    9999n,
    strategy
  );
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 200n);
});

test('skips own auction', () => {
  assert.strictEqual(shouldBid(auction({ isManager: true }), 9999n, strategy).bid, false);
});

test('skips when already winning', () => {
  assert.strictEqual(shouldBid(auction({ amIWinning: true }), 9999n, strategy).bid, false);
});

test('skips high minimum contribution', () => {
  assert.strictEqual(shouldBid(auction({ minimumContribution: 9999n }), 9999n, strategy).bid, false);
});

test('skips insufficient budget', () => {
  assert.strictEqual(shouldBid(auction({ minimumContribution: 1000n }), 500n, strategy).bid, false);
});

test('skips too little time', () => {
  assert.strictEqual(shouldBid(auction({ secondsLeft: 10 }), 9999n, strategy).bid, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
