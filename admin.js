// admin.js — local admin control panel HTTP server
// Run: npm run admin  → open http://localhost:3001
const http = require('http');
const fs   = require('fs');
const path = require('path');
const logger = require('./logger');
const { fetchAllAuctions, fetchMyBudget } = require('./auctions');
const { createAuction, createAuctionsFromConfig } = require('./seller');
const { bidOnEligibleAuctions, finalizeAuction, placeBid } = require('./bidder');
const { processClosedAuctions } = require('./winner');
const { getAccount, getWeb3, weiToEth, unwrapError, resyncNonce } = require('./chain');

const PORT = parseInt(process.env.ADMIN_PORT || '3002');

const botState = {
  running: false, cronHandle: null,
  lastCycle: null, cycleCount: 0,
  log: [],
  stats: { bids: 0, created: 0, finalized: 0, errors: 0 },
};

// Capture log lines for the UI
const _info  = logger.info.bind(logger);
const _warn  = logger.warn.bind(logger);
const _error = logger.error.bind(logger);
const pushLog = (level, msg) => {
  botState.log.unshift({ time: new Date().toISOString(), level, msg: typeof msg === 'object' ? JSON.stringify(msg) : String(msg) });
  if (botState.log.length > 200) botState.log.length = 200;
};
logger.info  = (m, ...a) => { pushLog('info',  m); _info(m,  ...a); };
logger.warn  = (m, ...a) => { pushLog('warn',  m); _warn(m,  ...a); };
logger.error = (m, ...a) => { pushLog('error', m); _error(m, ...a); };

// ── JSON helper ───────────────────────────────────────────────────
function json(res, data, status = 200, corsHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify(data, null, 2));
}

// ── API ───────────────────────────────────────────────────────────
async function handleApi(req, res, body, cors) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const ep  = url.pathname;

  if (req.method === 'GET' && ep === '/api/status') {
    const account  = getAccount();
    const balance  = await getWeb3().eth.getBalance(account.address);
    const budget   = await fetchMyBudget();
    const auctions = await fetchAllAuctions();
    return json(res, {
      wallet: account.address,
      balanceETH: weiToEth(balance.toString()),
      budgetWei: budget.toString(),
      auctionCount: auctions.length,
      openAuctions: auctions.filter(a => a.isActive).length,
      botRunning: botState.running,
      lastCycle: botState.lastCycle,
      cycleCount: botState.cycleCount,
      stats: botState.stats,
      config: getConfig(),
    }, 200, cors);
  }

  if (req.method === 'GET' && ep === '/api/auctions') {
    const auctions = await fetchAllAuctions();
    return json(res, auctions.map(serializeAuction), 200, cors);
  }

  if (req.method === 'GET' && ep === '/api/logs')
    return json(res, botState.log, 200, cors);

  if (req.method === 'GET' && ep === '/api/diagnostics') {
    const web3 = getWeb3();
    const factoryAddr = require('./chain').getFactoryAddress();
    let factoryExists = false;
    let rawAddresses = [];
    try {
      const code = await web3.eth.getCode(factoryAddr);
      factoryExists = code !== '0x';
      if (factoryExists) {
        const factory = getFactory();
        rawAddresses = await factory.methods.getDeployedCampaigns().call();
      }
    } catch (e) {}
    
    const auctions = await fetchAllAuctions();
    return json(res, {
      factoryAddress: factoryAddr,
      factoryExists: factoryExists,
      rawAddressesCount: rawAddresses.length,
      rawAddresses: rawAddresses.slice(0, 5),
      totalAuctions: auctions.length,
      validAuctions: auctions.length,
      rpcUrl: process.env.RPC_HTTP ? '✅ configured' : '❌ missing',
      hint: !factoryExists ? 'Factory contract not found at address. Check FACTORY_ADDRESS in .env and datamarketplaces.net' : rawAddresses.length === 0 ? 'Factory found but no auctions.' : auctions.length === 0 && rawAddresses.length > 0 ? 'Factory returns addresses but they fail to load. Campaign ABI may be incorrect.' : 'System OK'
    }, 200, cors);
  }

  if (req.method === 'GET' && ep === '/api/factory-raw') {
    try {
      const factory = getFactory();
      const addresses = await factory.methods.getDeployedCampaigns().call();
      logger.info(`DEBUG: Factory returned ${addresses.length} auction addresses`);
      return json(res, { 
        count: addresses.length, 
        addresses: addresses.slice(0, 10),
        message: addresses.length > 0 ? `${addresses.length} total auctions available. First 10 shown.` : 'Factory returned 0 auctions'
      }, 200, cors);
    } catch (err) {
      return json(res, { error: unwrapError(err), message: 'Failed to query factory' }, 500, cors);
    }
  }

  if (req.method === 'GET' && ep === '/api/config')
    return json(res, getConfig(), 200, cors);

  if (req.method === 'POST' && ep === '/api/config') {
    const data = JSON.parse(body || '{}');
    const allowed = ['MAX_BID_WEI','OUTBID_BY_WEI','MAX_MIN_CONTRIBUTION_WEI','SKIP_IF_WINNING',
      'MIN_TIME_REMAINING_SEC','AUTO_TRADE_CRON','AUTO_CREATE_AUCTIONS','BOT_MODE'];
    for (const k of allowed) if (data[k] !== undefined) process.env[k] = String(data[k]);
    logger.info('⚙️  Config updated', data);
    return json(res, { ok: true, config: getConfig() }, 200, cors);
  }

  if (req.method === 'POST' && ep === '/api/start') {
    if (botState.running) return json(res, { ok: false, error: 'Already running' }, 200, cors);
    startAutoLoop();
    return json(res, { ok: true }, 200, cors);
  }

  if (req.method === 'POST' && ep === '/api/stop') {
    stopAutoLoop();
    return json(res, { ok: true }, 200, cors);
  }

  if (req.method === 'POST' && ep === '/api/run-once') {
    runCycle().catch(e => logger.error('Cycle error', { error: unwrapError(e) }));
    return json(res, { ok: true }, 200, cors);
  }

  if (req.method === 'POST' && ep === '/api/create-auction') {
    try {
      const r = await createAuction(JSON.parse(body));
      botState.stats.created++;
      return json(res, { ok: true, result: r.newAddress || 'simulated' }, 200, cors);
    } catch (err) { return json(res, { ok: false, error: unwrapError(err) }, 400, cors); }
  }

  if (req.method === 'POST' && ep === '/api/bid') {
    const { address, amountWei } = JSON.parse(body);
    try {
      const r = await placeBid(address, BigInt(amountWei));
      botState.stats.bids++;
      return json(res, { ok: true, tx: r.transactionHash }, 200, cors);
    } catch (err) {
      await resyncNonce();
      return json(res, { ok: false, error: unwrapError(err) }, 400, cors);
    }
  }

  if (req.method === 'POST' && ep === '/api/finalize') {
    const { address } = JSON.parse(body);
    try {
      const r = await finalizeAuction(address);
      botState.stats.finalized++;
      return json(res, { ok: true, tx: r?.transactionHash || 'simulated' }, 200, cors);
    } catch (err) { return json(res, { ok: false, error: unwrapError(err) }, 400, cors); }
  }

  if (req.method === 'POST' && ep === '/api/check-winner') {
    const results = await processClosedAuctions();
    return json(res, { ok: true, results }, 200, cors);
  }

  if (req.method === 'POST' && ep === '/api/run-mode') {
    const { mode } = JSON.parse(body);
    try {
      await runMode(mode);
      return json(res, { ok: true, message: `Mode ${mode} executed successfully` }, 200, cors);
    } catch (err) {
      return json(res, { ok: false, error: unwrapError(err) }, 400, cors);
    }
  }

  return json(res, { error: 'Not found' }, 404, cors);
}

// ── Run Mode ─────────────────────────────────────────────────────
async function runMode(mode) {
  const { fetchAllAuctions } = require('./auctions');
  const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
  const { createAuctionsFromConfig } = require('./seller');
  const { processClosedAuctions } = require('./winner');
  const { startCron } = require('./autotrader');
  const { runSimulation } = require('./simulator');
  const { startListening } = require('./listener');

  switch (mode) {
    case 'simulate':
    case 'status':
      await runSimulation();
      break;
    case 'buy':
      const auctionsBuy = await fetchAllAuctions();
      for (const a of auctionsBuy.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0))
        await finalizeAuction(a.address);
      const resultsBuy = await bidOnEligibleAuctions(auctionsBuy.filter(a => a.isActive));
      logger.info(`Buy mode: ${resultsBuy.filter(r=>r.success).length} bids placed`);
      break;
    case 'sell':
      const resultsSell = await createAuctionsFromConfig();
      logger.info(`Sell mode: ${resultsSell.filter(r=>r.success).length} auctions created`);
      break;
    case 'smart':
      const auctionsSmart = await fetchAllAuctions();
      for (const a of auctionsSmart.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0))
        await finalizeAuction(a.address);
      const createResultsSmart = await createAuctionsFromConfig();
      logger.info(`Smart: Created ${createResultsSmart.filter(r=>r.success).length} auctions`);
      const bidResultsSmart = await bidOnEligibleAuctions(auctionsSmart.filter(a => a.isActive), 'smart');
      logger.info(`Smart: ${bidResultsSmart.filter(r=>r.success).length} bids placed`);
      break;
    case 'dumb':
      const auctionsDumb = await fetchAllAuctions();
      for (const a of auctionsDumb.filter(x => !x.isActive && !x.closed && x.isManager && x.approversCount > 0))
        await finalizeAuction(a.address);
      const createResultsDumb = await createAuctionsFromConfig();
      logger.info(`Dumb: Created ${createResultsDumb.filter(r=>r.success).length} auctions`);
      const bidResultsDumb = await bidOnEligibleAuctions(auctionsDumb.filter(a => a.isActive), 'dumb');
      logger.info(`Dumb: ${bidResultsDumb.filter(r=>r.success).length} bids placed`);
      break;
    case 'auto':
      await startListening();
      startCron();
      break;
    case 'winner':
      await processClosedAuctions();
      break;
    case 'listen':
      await startListening((addr, contributor) =>
        logger.info(`[LIVE] Bid on ${addr} by ${contributor}`)
      );
      break;
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}

// ── Auto loop ─────────────────────────────────────────────────────
function startAutoLoop() {
  const cron = require('node-cron');
  const schedule = process.env.AUTO_TRADE_CRON || '*/2 * * * *';
  if (!cron.validate(schedule)) { logger.error(`Invalid cron: ${schedule}`); return; }
  botState.cronHandle = cron.schedule(schedule, runCycle);
  botState.running    = true;
  logger.info(`🤖 Bot started — cron: ${schedule}`);
  runCycle();
}

function stopAutoLoop() {
  if (botState.cronHandle) { botState.cronHandle.stop(); botState.cronHandle = null; }
  botState.running = false;
  logger.info('🛑 Bot stopped');
}

async function runCycle() {
  botState.cycleCount++;
  botState.lastCycle = new Date().toISOString();
  logger.info(`\n⚡ Cycle #${botState.cycleCount}`);
  try {
    const auctions = await fetchAllAuctions();

    // Auto-create if no open auctions
    if (process.env.AUTO_CREATE_AUCTIONS === 'true' && !auctions.some(a => a.isActive)) {
      logger.info('No open auctions — auto-creating...');
      const created = await createAuctionsFromConfig();
      botState.stats.created += created.filter(r => r.success).length;
    }

    // Finalize
    for (const a of auctions.filter(a => !a.isActive && !a.closed && a.isManager && a.approversCount > 0)) {
      try { await finalizeAuction(a.address); botState.stats.finalized++; }
      catch (_) { botState.stats.errors++; }
    }

    // Bid
    const results = await bidOnEligibleAuctions(auctions.filter(a => a.isActive));
    botState.stats.bids   += results.filter(r => r.success && !r.simulated).length;
    botState.stats.errors += results.filter(r => !r.success).length;
  } catch (err) {
    logger.error('Cycle error', { error: unwrapError(err) });
    botState.stats.errors++;
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function getConfig() {
  return {
    BOT_MODE:                 process.env.BOT_MODE                  || 'simulate',
    MAX_BID_WEI:              process.env.MAX_BID_WEI               || '5000',
    OUTBID_BY_WEI:            process.env.OUTBID_BY_WEI             || '100',
    MAX_MIN_CONTRIBUTION_WEI: process.env.MAX_MIN_CONTRIBUTION_WEI  || '2000',
    SKIP_IF_WINNING:          process.env.SKIP_IF_WINNING            || 'true',
    MIN_TIME_REMAINING_SEC:   process.env.MIN_TIME_REMAINING_SEC     || '60',
    AUTO_TRADE_CRON:          process.env.AUTO_TRADE_CRON            || '*/2 * * * *',
    AUTO_CREATE_AUCTIONS:     process.env.AUTO_CREATE_AUCTIONS       || 'false',
    FACTORY_ADDRESS:          process.env.FACTORY_ADDRESS,
  };
}

function serializeAuction(a) {
  return {
    address: a.address, dataDescription: a.dataDescription, dataForSell: a.dataForSell,
    minimumContribution: a.minimumContribution.toString(), highestBid: a.highestBid.toString(),
    approversCount: a.approversCount, endTimeSec: a.endTimeSec, secondsLeft: a.secondsLeft,
    isActive: a.isActive, isManager: a.isManager, isWinner: a.isWinner,
    amIBidding: a.amIBidding, amIWinning: a.amIWinning, myBid: a.myBid.toString(), closed: a.closed,
  };
}

// ── HTTP server ───────────────────────────────────────────────────
function startAdminServer() {
  const CORS = {
    'Access-Control-Allow-Origin':  `http://localhost:${PORT}`,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    // Serve the UI
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      // admin.html is in the same folder as this file
      const htmlPath = path.join(__dirname, 'admin.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        await handleApi(req, res, body, CORS);
      } catch (err) {
        logger.error('Admin API error', { error: unwrapError(err) });
        json(res, { error: unwrapError(err) }, 500, CORS);
      }
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    logger.info(`\n🖥️  Admin panel ready!`);
    logger.info(`   Open in browser: http://localhost:${PORT}`);
    logger.info(`   ⚠️  Do NOT open admin.html directly as a file\n`);
  });

  return server;
}

module.exports = { startAdminServer, runCycle, startAutoLoop, stopAutoLoop, botState };
