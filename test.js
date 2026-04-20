// test.js — run with: npm test
const assert = require('assert');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.error(`  ❌ ${name}\n     → ${err.message}`); failed++; }
}

// ── Inline shouldBid logic (no chain needed) ──────────────────────
function shouldBid(auction, me, myBudget, opts = {}) {
  const MAX_BID_WEI     = BigInt(opts.maxBid    ?? '5000');
  const OUTBID_BY_WEI   = BigInt(opts.outbidBy  ?? '100');
  const MAX_MIN_CONTRIB = BigInt(opts.maxMinBid  ?? '2000');
  const SKIP_IF_WINNING = opts.skipIfWinning     ?? true;
  const MIN_TIME_SEC    = opts.minTimeSec        ?? 60;

  if (!auction.isActive)                       return { bid: false, reason: 'Auction closed' };
  if (auction.secondsLeft < MIN_TIME_SEC)      return { bid: false, reason: 'Too little time' };
  if (auction.isManager)                       return { bid: false, reason: 'You are the seller' };
  if (SKIP_IF_WINNING && auction.amIWinning)   return { bid: false, reason: 'Already winning' };
  if (auction.minimumContribution > MAX_MIN_CONTRIB) return { bid: false, reason: 'Min contribution too high' };

  let bidAmount = auction.approversCount === 0 ? auction.minimumContribution : auction.highestBid + OUTBID_BY_WEI;
  let sendAmount = bidAmount;
  if (auction.amIBidding && auction.myBid > 0n) {
    sendAmount = bidAmount - auction.myBid;
    if (sendAmount <= 0n) return { bid: false, reason: 'Already covered' };
  }
  if (sendAmount > MAX_BID_WEI)  return { bid: false, reason: 'Exceeds MAX_BID_WEI' };
  if (sendAmount > myBudget)     return { bid: false, reason: 'Insufficient budget' };
  return { bid: true, reason: 'OK', amount: sendAmount };
}

const mk = (o = {}) => ({
  address: '0xA', dataDescription: 'Test', isActive: true, secondsLeft: 300,
  isManager: false, amIWinning: false, amIBidding: false, myBid: 0n,
  minimumContribution: 500n, highestBid: 0n, approversCount: 0, closed: false, ...o,
});

console.log('\n📋 shouldBid() tests\n');
test('Bids minimumContribution when no bids', () => { const r = shouldBid(mk(), 'me', 9999n); assert(r.bid); assert.strictEqual(r.amount, 500n); });
test('Outbids current highest', () => { const r = shouldBid(mk({ approversCount:1, highestBid:1000n, minimumContribution:100n }), 'me', 9999n, { outbidBy:'200' }); assert(r.bid); assert.strictEqual(r.amount, 1200n); });
test('Sends only increment if already bidding', () => { const r = shouldBid(mk({ approversCount:2, highestBid:1500n, minimumContribution:100n, amIBidding:true, myBid:1000n }), 'me', 9999n, { outbidBy:'100' }); assert(r.bid); assert.strictEqual(r.amount, 600n); });
test('Skips closed', () => { assert(!shouldBid(mk({ isActive:false }), 'me', 9999n).bid); });
test('Skips own auction', () => { assert(!shouldBid(mk({ isManager:true }), 'me', 9999n).bid); });
test('Skips when winning', () => { assert(!shouldBid(mk({ amIWinning:true }), 'me', 9999n).bid); });
test('Bids when winning if skipIfWinning=false', () => { const r = shouldBid(mk({ amIWinning:true, approversCount:1, highestBid:500n, minimumContribution:100n }), 'me', 9999n, { skipIfWinning:false, outbidBy:'50' }); assert(r.bid); });
test('Skips high min contribution', () => { assert(!shouldBid(mk({ minimumContribution:9999n }), 'me', 99999n, { maxMinBid:'1000' }).bid); });
test('Skips when exceeds MAX_BID_WEI', () => { assert(!shouldBid(mk({ approversCount:1, highestBid:9000n, minimumContribution:100n }), 'me', 99999n, { maxBid:'500', outbidBy:'100' }).bid); });
test('Skips insufficient budget', () => { assert(!shouldBid(mk({ minimumContribution:1000n }), 'me', 500n).bid); });
test('Skips too little time', () => { assert(!shouldBid(mk({ secondsLeft:10 }), 'me', 9999n, { minTimeSec:60 }).bid); });
test('Skips when already covered', () => { assert(!shouldBid(mk({ approversCount:1, highestBid:500n, amIBidding:true, myBid:700n, minimumContribution:100n }), 'me', 9999n, { outbidBy:'100' }).bid); });

console.log('\n📋 CSV tests\n');
function toCSV(txs) { return ['bidder,bid,time', ...txs.map(t=>`"${t.bidder}","${t.bid}","${t.time}"`)].join('\n'); }
test('Correct header', () => { assert(toCSV([{bidder:'0xA',bid:'1',time:'t'}]).startsWith('bidder,bid,time')); });
test('Correct row count', () => { assert.strictEqual(toCSV([{bidder:'a',bid:'1',time:'t'},{bidder:'b',bid:'2',time:'t'}]).split('\n').length, 3); });

console.log('\n📋 Validation tests\n');
function validate(item) {
  const e = [];
  if (!Number.isInteger(Number(item.minimumContribution)) || Number(item.minimumContribution) <= 0) e.push('minimumContribution');
  if (!Number.isInteger(Number(item.auctionDuration)) || item.auctionDuration<1 || item.auctionDuration>30) e.push('auctionDuration');
  if (!String(item.dataForSell||'').trim())     e.push('dataForSell');
  if (!String(item.dataDescription||'').trim()) e.push('dataDescription');
  return e;
}
test('Valid item passes', () => { assert.strictEqual(validate({minimumContribution:500,auctionDuration:10,dataForSell:'d',dataDescription:'desc'}).length, 0); });
test('Rejects zero minContrib', () => { assert(validate({minimumContribution:0,auctionDuration:10,dataForSell:'d',dataDescription:'d'}).includes('minimumContribution')); });
test('Rejects duration>30', () => { assert(validate({minimumContribution:100,auctionDuration:31,dataForSell:'d',dataDescription:'d'}).includes('auctionDuration')); });
test('Rejects empty data', () => { assert(validate({minimumContribution:100,auctionDuration:5,dataForSell:'',dataDescription:'d'}).includes('dataForSell')); });

console.log(`\n${'─'.repeat(40)}\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log('All tests passed ✅\n');
