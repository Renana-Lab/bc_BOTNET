const assert = require('assert');
const { shouldBid, pickRandomAuctionForCycle } = require('../src/market/bidder');
const { normalizeTransactionHash } = require('../src/chain');

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
  OUTBID_BY_WEI: 10n,
  MAX_MIN_CONTRIB: 2000n,
  SKIP_IF_WINNING: true,
  MIN_TIME_SEC: 60,
};

console.log('\nshouldBid() tests\n');

test('places first bid on empty auction', () => {
  const result = shouldBid(auction(), 9999n, strategy);
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 500n);
});

test('bids on selected auction with outside highest bid', () => {
  const result = shouldBid(auction({
    approversCount: 1,
    bidderAddresses: ['0xother'],
    highestBid: 1000n,
    minimumContribution: 100n,
  }), 9999n, strategy);
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 1010n);
});

test('outbids by 10 wei after another bidder beats current bid', () => {
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
  assert.strictEqual(result.amount, 510n);
});

test('can revisit same auction and outbid again when selected', () => {
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
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 510n);
});

test('tops up selected sole leading auction by 10 wei', () => {
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
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 10n);
});

test('still counter-bids when another bidder exists and counter is unused', () => {
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
  assert.strictEqual(result.amount, 110n);
});

test('skips own auction', () => {
  assert.strictEqual(shouldBid(auction({ isManager: true }), 9999n, strategy).bid, false);
});

test('can top up when selected auction is already winning', () => {
  const result = shouldBid(auction({
    amIWinning: true,
    amIBidding: true,
    myBid: 500n,
    highestBid: 500n,
    approversCount: 1,
  }), 9999n, strategy);
  assert.strictEqual(result.bid, true);
  assert.strictEqual(result.amount, 10n);
});

test('skips high minimum contribution', () => {
  assert.strictEqual(shouldBid(auction({ minimumContribution: 9999n }), 9999n, strategy).bid, false);
});

test('skips insufficient budget', () => {
  assert.strictEqual(shouldBid(auction({
    approversCount: 2,
    bidderAddresses: ['0xme', '0xother'],
    highestBid: 1000n,
    amIBidding: true,
    myBid: 900n,
    minimumContribution: 100n,
  }), 100n, strategy).bid, false);
});

test('skips when total target bid exceeds max bid', () => {
  const result = shouldBid(auction({
    approversCount: 2,
    bidderAddresses: ['0xme', '0xother'],
    highestBid: 5000n,
    amIBidding: true,
    myBid: 4900n,
    minimumContribution: 100n,
  }), 9999n, strategy);
  assert.strictEqual(result.bid, false);
  assert.strictEqual(result.reason, 'Exceeds MAX_BID_WEI');
});

test('skips too little time', () => {
  assert.strictEqual(shouldBid(auction({ secondsLeft: 10 }), 9999n, strategy).bid, false);
});

test('random picker avoids leading auctions when alternatives exist', () => {
  const leading = auction({ address: '0xlead', amIWinning: true, amIBidding: true, myBid: 500n, highestBid: 500n, approversCount: 1 });
  const other = auction({ address: '0xother', highestBid: 0n, approversCount: 0 });
  const picked = withMockedRandom(0, () => pickRandomAuctionForCycle([leading, other]));
  assert.strictEqual(picked.address, '0xother');
});

test('random picker can choose leading auction when it is the only open auction', () => {
  const leading = auction({ address: '0xlead', amIWinning: true, amIBidding: true, myBid: 500n, highestBid: 500n, approversCount: 1 });
  const picked = withMockedRandom(0, () => pickRandomAuctionForCycle([leading]));
  assert.strictEqual(picked.address, '0xlead');
});

test('normalizes transaction hash objects from providers', () => {
  const hash = `0x${'a'.repeat(64)}`;
  assert.strictEqual(normalizeTransactionHash(hash), hash);
  assert.strictEqual(normalizeTransactionHash({ result: hash }), hash);
  assert.strictEqual(normalizeTransactionHash({ transactionHash: hash }), hash);
  assert.strictEqual(normalizeTransactionHash({ receipt: { transactionHash: hash } }), hash);
});

function withMockedRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
