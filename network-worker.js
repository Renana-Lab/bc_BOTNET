require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const cron = require('node-cron');
const logger = require('./logger');
const { init, getAccount, unwrapError } = require('./chain');
const { fetchAllAuctions } = require('./auctions');
const { bidOnEligibleAuctions, finalizeAuction } = require('./bidder');
const { maintainAuctionInventory } = require('./seller');
const { startListening } = require('./listener');

const state = {
  running: false,
  cycleRunning: false,
  stats: { bids: 0, created: 0, finalized: 0, errors: 0, cycles: 0 },
  lastCycleAt: null,
  lastError: null,
  wallet: null,
};

let cronHandle = null;
let listenerStarted = false;
let liveTriggerTimer = null;

patchLoggerForIpc();

async function main() {
  try {
    await init();
    state.wallet = getAccount().address;
    emit('ready', {
      id: process.env.BOT_NETWORK_ID,
      name: process.env.BOT_DISPLAY_NAME,
      wallet: state.wallet,
      running: false,
      stats: state.stats,
    });

    if (process.env.BOT_AUTOSTART !== 'false') {
      startLoop();
    }
  } catch (err) {
    state.lastError = unwrapError(err);
    emit('fatal', { error: state.lastError });
    process.exit(1);
  }
}

function startLoop() {
  if (state.running) return;
  const schedule = process.env.AUTO_TRADE_CRON || '*/2 * * * *';
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: ${schedule}`);
  }

  cronHandle = cron.schedule(schedule, () => {
    runCycle('cron').catch((err) => {
      state.lastError = unwrapError(err);
      emitStatus();
    });
  });

  state.running = true;
  ensureListener();
  emitStatus();
  runCycle('startup').catch((err) => {
    state.lastError = unwrapError(err);
    emitStatus();
  });
}

function stopLoop() {
  if (cronHandle) {
    cronHandle.stop();
    cronHandle = null;
  }
  state.running = false;
  emitStatus();
}

async function runCycle(trigger = 'manual') {
  if (state.cycleRunning) {
    logger.warn(`Worker cycle skipped because another cycle is already running (${trigger})`);
    return;
  }

  state.cycleRunning = true;
  state.stats.cycles += 1;
  state.lastCycleAt = new Date().toISOString();
  state.lastError = null;
  emitStatus();

  try {
    const auctions = await fetchAllAuctions();

    if (process.env.ENABLE_SELLING === 'true') {
      const created = await maintainAuctionInventory(auctions);
      state.stats.created += created.filter((item) => item.success).length;
      state.stats.errors += created.filter((item) => !item.success).length;
    }

    if (process.env.ENABLE_FINALIZE !== 'false') {
      for (const auction of auctions.filter((item) => !item.isActive && !item.closed && item.isManager && item.approversCount > 0)) {
        try {
          const result = await finalizeAuction(auction.address);
          if (!result?.skipped) state.stats.finalized += 1;
        } catch (err) {
          state.stats.errors += 1;
          logger.error(`Worker finalize failed for ${auction.address}`, { error: unwrapError(err) });
        }
      }
    }

    if (process.env.ENABLE_BIDDING !== 'false') {
      const results = await bidOnEligibleAuctions(auctions.filter((item) => item.isActive));
      state.stats.bids += results.filter((item) => item.success && !item.simulated).length;
      state.stats.errors += results.filter((item) => !item.success).length;
    }
  } catch (err) {
    state.stats.errors += 1;
    state.lastError = unwrapError(err);
    logger.error('Worker cycle error', { error: state.lastError });
  } finally {
    state.cycleRunning = false;
    emit('cycle-complete', {
      wallet: state.wallet,
      running: state.running,
      stats: state.stats,
      lastCycleAt: state.lastCycleAt,
      lastError: state.lastError,
    });
  }
}

function ensureListener() {
  if (listenerStarted) return;
  listenerStarted = true;

  startListening(() => {
    clearTimeout(liveTriggerTimer);
    liveTriggerTimer = setTimeout(() => {
      runCycle('live').catch((err) => {
        state.lastError = unwrapError(err);
        emitStatus();
      });
    }, 1200);
  }).catch((err) => {
    logger.warn('Worker listener unavailable', { error: err.message });
  });
}

function emitStatus() {
  emit('status', {
    wallet: state.wallet,
    running: state.running,
    stats: state.stats,
    lastCycleAt: state.lastCycleAt,
    lastError: state.lastError,
  });
}

function emit(type, payload = {}) {
  if (typeof process.send === 'function') {
    process.send({ type, ...payload });
  }
}

function patchLoggerForIpc() {
  for (const level of ['info', 'warn', 'error']) {
    const base = logger[level].bind(logger);
    logger[level] = (message, meta = {}) => {
      emit('log', { level, message: String(message), meta });
      base(message, meta);
    };
  }
}

process.on('message', (message = {}) => {
  if (message.type === 'shutdown') {
    stopLoop();
    process.exit(0);
  }
  if (message.type === 'run-once') {
    runCycle('controller').catch((err) => {
      state.lastError = unwrapError(err);
      emitStatus();
    });
  }
  if (message.type === 'start') {
    startLoop();
  }
  if (message.type === 'stop') {
    stopLoop();
  }
});

main();
