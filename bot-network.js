const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'bots.json');
const WORKER_PATH = path.join(__dirname, 'network-worker.js');
const MAX_LOG_LINES = 80;

const runtime = new Map();
let cleanupBound = false;

function listBots() {
  const bots = readBots();
  return bots.map((bot) => serializeBot(bot));
}

function getBotNetworkStatus() {
  const bots = listBots();
  return { bots, summary: summarizeBots(bots) };
}

function getBot(id) {
  return readBots().find((bot) => bot.id === id) || null;
}

function saveBot(input = {}) {
  const bots = readBots();
  const id = input.id || createBotId(input.name || 'bot');
  const existing = bots.find((bot) => bot.id === id);
  const next = {
    id,
    name: String(input.name || existing?.name || `Bot ${id.slice(-4)}`).trim(),
    privateKey: String(input.privateKey || existing?.privateKey || '').trim(),
    enabled: normalizeBool(input.enabled, existing?.enabled ?? true),
    overrides: sanitizeOverrides({
      ...(existing?.overrides || {}),
      ...(input.overrides || {}),
    }),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!next.privateKey || !next.privateKey.startsWith('0x')) {
    throw new Error('Each bot needs a valid private key');
  }

  const index = bots.findIndex((bot) => bot.id === id);
  if (index >= 0) {
    bots[index] = next;
  } else {
    bots.push(next);
  }

  writeBots(bots);
  return serializeBot(next);
}

async function deleteBot(id) {
  await stopBot(id);
  const bots = readBots().filter((bot) => bot.id !== id);
  writeBots(bots);
  runtime.delete(id);
  return { ok: true };
}

async function startBot(id) {
  bindCleanup();
  const bot = getBot(id);
  if (!bot) throw new Error('Bot not found');

  const current = runtime.get(id);
  if (current?.child && !current.child.killed) {
    return serializeBot(bot);
  }

  const child = fork(WORKER_PATH, [], {
    cwd: __dirname,
    env: buildBotEnv(bot),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const state = current || { status: 'starting', logs: [] };
  state.child = child;
  state.pid = child.pid;
  state.status = 'starting';
  state.lastError = null;
  runtime.set(id, state);

  child.stdout?.on('data', (chunk) => appendRuntimeLog(id, 'stdout', chunk.toString()));
  child.stderr?.on('data', (chunk) => appendRuntimeLog(id, 'stderr', chunk.toString()));

  child.on('message', (message) => handleWorkerMessage(id, message));
  child.on('exit', (code, signal) => {
    const currentState = runtime.get(id) || {};
    currentState.child = null;
    currentState.pid = null;
    currentState.status = code === 0 ? 'stopped' : 'crashed';
    currentState.signal = signal || null;
    currentState.exitCode = code;
    currentState.lastSeenAt = new Date().toISOString();
    runtime.set(id, currentState);
  });

  return serializeBot(bot);
}

async function stopBot(id) {
  const state = runtime.get(id);
  if (!state?.child || state.child.killed) {
    return { ok: true };
  }

  const child = state.child;
  state.status = 'stopping';
  child.send({ type: 'shutdown' });

  await waitForExit(child, 5000).catch(() => {
    try {
      child.kill();
    } catch (_) {}
  });

  return { ok: true };
}

async function runBotOnce(id) {
  const state = runtime.get(id);
  if (!state?.child || state.child.killed) {
    throw new Error('Bot is not running');
  }
  state.child.send({ type: 'run-once' });
  return { ok: true };
}

async function startEnabledBots() {
  const bots = readBots().filter((bot) => bot.enabled);
  for (const bot of bots) {
    await startBot(bot.id);
  }
  return listBots();
}

async function stopAllBots() {
  const ids = [...runtime.keys()];
  for (const id of ids) {
    await stopBot(id);
  }
  return { ok: true };
}

async function runSelectedBotsOnce(scope = 'running') {
  const targets = selectBotsByScope(readBots(), scope);
  let triggered = 0;
  let skipped = 0;

  for (const bot of targets) {
    const state = runtime.get(bot.id);
    if (!state?.child || state.child.killed) {
      skipped += 1;
      continue;
    }
    state.child.send({ type: 'run-once' });
    triggered += 1;
  }

  return { ok: true, triggered, skipped };
}

async function orchestrateBots(input = {}) {
  const scope = input.scope || 'all';
  const restartRunning = String(input.restartRunning) === 'true';
  const patchEnabled = input.enabled === undefined || input.enabled === null || input.enabled === ''
    ? undefined
    : normalizeBool(input.enabled, true);
  const patchOverrides = sanitizeBroadcastOverrides(input.overrides || {});

  const bots = readBots();
  const targets = selectBotsByScope(bots, scope);
  const targetIds = new Set(targets.map((bot) => bot.id));
  const runningIds = targets
    .filter((bot) => {
      const state = runtime.get(bot.id);
      return state?.child && !state.child.killed;
    })
    .map((bot) => bot.id);

  for (const bot of bots) {
    if (!targetIds.has(bot.id)) continue;
    if (patchEnabled !== undefined) {
      bot.enabled = patchEnabled;
    }
    if (Object.keys(patchOverrides).length > 0) {
      bot.overrides = {
        ...(bot.overrides || {}),
        ...patchOverrides,
      };
    }
    bot.updatedAt = new Date().toISOString();
  }

  writeBots(bots);

  let restarted = 0;
  if (restartRunning) {
    for (const id of runningIds) {
      await stopBot(id);
      const nextBot = getBot(id);
      if (nextBot?.enabled !== false) {
        await startBot(id);
        restarted += 1;
      }
    }
  }

  const status = getBotNetworkStatus();
  return {
    ok: true,
    updated: targets.length,
    restarted,
    ...status,
  };
}

function serializeBot(bot) {
  const state = runtime.get(bot.id) || {};
  return {
    id: bot.id,
    name: bot.name,
    enabled: bot.enabled,
    overrides: bot.overrides || {},
    wallet: state.wallet || null,
    status: state.status || 'stopped',
    pid: state.pid || null,
    lastSeenAt: state.lastSeenAt || null,
    lastCycleAt: state.lastCycleAt || null,
    stats: state.stats || null,
    lastError: state.lastError || null,
    logTail: (state.logs || []).slice(-12),
    privateKeyMasked: maskPrivateKey(bot.privateKey),
  };
}

function handleWorkerMessage(id, message = {}) {
  const state = runtime.get(id) || { logs: [] };
  state.lastSeenAt = new Date().toISOString();

  if (message.type === 'ready') {
    state.wallet = message.wallet;
    state.status = message.running ? 'running' : 'ready';
    state.stats = message.stats || state.stats || null;
  } else if (message.type === 'status') {
    state.status = message.running ? 'running' : 'idle';
    state.wallet = message.wallet || state.wallet || null;
    state.stats = message.stats || state.stats || null;
    state.lastCycleAt = message.lastCycleAt || state.lastCycleAt || null;
    state.lastError = message.lastError || state.lastError || null;
  } else if (message.type === 'cycle-complete') {
    state.status = 'running';
    state.lastCycleAt = message.lastCycleAt || new Date().toISOString();
    state.stats = message.stats || state.stats || null;
    state.lastError = message.lastError || null;
  } else if (message.type === 'fatal') {
    state.status = 'crashed';
    state.lastError = message.error || 'Worker failed';
  } else if (message.type === 'log') {
    appendRuntimeLog(id, message.level || 'info', message.message, message.meta);
    return;
  }

  runtime.set(id, state);
}

function appendRuntimeLog(id, level, message, meta = null) {
  const state = runtime.get(id) || { logs: [] };
  state.logs = state.logs || [];
  const text = String(message || '').trim();
  if (!text) {
    runtime.set(id, state);
    return;
  }
  state.logs.push({
    time: new Date().toISOString(),
    level,
    message: meta ? `${text} ${JSON.stringify(meta)}` : text,
  });
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs = state.logs.slice(-MAX_LOG_LINES);
  }
  runtime.set(id, state);
}

function buildBotEnv(bot) {
  const overrides = bot.overrides || {};
  const env = {
    ...process.env,
    PRIVATE_KEY: bot.privateKey,
    BOT_NETWORK_ID: bot.id,
    BOT_DISPLAY_NAME: bot.name,
    BOT_AUTOSTART: 'true',
    BOT_MODE: 'auto',
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null && value !== '') {
      env[key] = String(value);
    }
  }

  return env;
}

function sanitizeOverrides(input = {}) {
  const allowedKeys = [
    'AUTO_TRADE_CRON',
    'TRADING_PROFILE',
    'MAX_BID_WEI',
    'OUTBID_BY_WEI',
    'MAX_MIN_CONTRIBUTION_WEI',
    'MIN_TIME_REMAINING_SEC',
    'SKIP_IF_WINNING',
    'ENABLE_BIDDING',
    'ENABLE_SELLING',
    'ENABLE_FINALIZE',
    'AUTO_GENERATE_AUCTIONS',
    'AUTO_GENERATE_COUNT',
    'TARGET_ACTIVE_SELL_AUCTIONS',
    'MAX_TOTAL_SELL_AUCTIONS',
  ];

  const out = {};
  for (const key of allowedKeys) {
    if (input[key] !== undefined) {
      out[key] = String(input[key]);
    }
  }
  return out;
}

function sanitizeBroadcastOverrides(input = {}) {
  const out = {};
  const allowed = sanitizeOverrides(input);
  for (const [key, value] of Object.entries(allowed)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

function readBots() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const bots = JSON.parse(raw);
    return Array.isArray(bots) ? bots : [];
  } catch (_) {
    return [];
  }
}

function writeBots(bots) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(bots, null, 2), 'utf8');
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, '[]\n', 'utf8');
}

function createBotId(name) {
  const slug = String(name || 'bot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'bot';
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskPrivateKey(privateKey) {
  const text = String(privateKey || '');
  if (text.length < 14) return text ? 'configured' : 'missing';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function normalizeBool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value) !== 'false';
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) reject(new Error('Timed out waiting for worker exit'));
    }, timeoutMs);

    child.once('exit', () => {
      done = true;
      clearTimeout(timeout);
      resolve();
    });
  });
}

function bindCleanup() {
  if (cleanupBound) return;
  cleanupBound = true;
  process.on('exit', () => {
    for (const state of runtime.values()) {
      try {
        state.child?.kill();
      } catch (_) {}
    }
  });
}

function selectBotsByScope(bots, scope = 'all') {
  switch (scope) {
    case 'enabled':
      return bots.filter((bot) => bot.enabled);
    case 'running':
      return bots.filter((bot) => {
        const state = runtime.get(bot.id);
        return state?.child && !state.child.killed;
      });
    case 'all':
    default:
      return bots;
  }
}

function summarizeBots(bots = []) {
  const summary = {
    registered: bots.length,
    enabled: 0,
    running: 0,
    crashed: 0,
    ready: 0,
    idle: 0,
    bids: 0,
    created: 0,
    finalized: 0,
    errors: 0,
  };

  for (const bot of bots) {
    if (bot.enabled) summary.enabled += 1;
    if (bot.status === 'running') summary.running += 1;
    if (bot.status === 'crashed') summary.crashed += 1;
    if (bot.status === 'ready') summary.ready += 1;
    if (bot.status === 'idle') summary.idle += 1;
    summary.bids += Number(bot.stats?.bids || 0);
    summary.created += Number(bot.stats?.created || 0);
    summary.finalized += Number(bot.stats?.finalized || 0);
    summary.errors += Number(bot.stats?.errors || 0);
  }

  return summary;
}

module.exports = {
  getBotNetworkStatus,
  listBots,
  saveBot,
  deleteBot,
  startBot,
  stopBot,
  runBotOnce,
  startEnabledBots,
  stopAllBots,
  runSelectedBotsOnce,
  orchestrateBots,
};
