const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '.env');

const DEFAULTS = {
  BOT_MODE: 'simulate',
  TRADING_PROFILE: 'balanced',
  MAX_BID_WEI: '5000',
  OUTBID_BY_WEI: '100',
  MAX_MIN_CONTRIBUTION_WEI: '2000',
  SKIP_IF_WINNING: 'true',
  MIN_TIME_REMAINING_SEC: '60',
  AUTO_TRADE_CRON: '*/2 * * * *',
  AUTO_CREATE_AUCTIONS: 'false',
  ENABLE_BIDDING: 'true',
  ENABLE_SELLING: 'false',
  ENABLE_FINALIZE: 'true',
  AUTO_GENERATE_AUCTIONS: 'true',
  AUTO_GENERATE_COUNT: '2',
  TARGET_ACTIVE_SELL_AUCTIONS: '2',
  MAX_TOTAL_SELL_AUCTIONS: '10',
  FACTORY_ADDRESS: '',
};

const BOOLEAN_KEYS = new Set([
  'SKIP_IF_WINNING',
  'AUTO_CREATE_AUCTIONS',
  'ENABLE_BIDDING',
  'ENABLE_SELLING',
  'ENABLE_FINALIZE',
  'AUTO_GENERATE_AUCTIONS',
]);

const CONFIG_KEYS = Object.keys(DEFAULTS);

function normalizeValue(key, value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULTS[key] ?? '';
  }

  if (BOOLEAN_KEYS.has(key)) {
    return String(value) === 'true' ? 'true' : 'false';
  }

  return String(value);
}

function getRuntimeConfig() {
  const out = {};
  for (const key of CONFIG_KEYS) {
    out[key] = normalizeValue(key, process.env[key]);
  }
  return out;
}

function updateRuntimeConfig(patch = {}) {
  const filtered = {};
  for (const key of CONFIG_KEYS) {
    if (patch[key] !== undefined) {
      const value = normalizeValue(key, patch[key]);
      process.env[key] = value;
      filtered[key] = value;
    }
  }

  if (Object.keys(filtered).length > 0) {
    persistEnvConfig(filtered);
  }

  return getRuntimeConfig();
}

function persistEnvConfig(patch) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  }

  let lines = content ? content.split(/\r?\n/) : [];

  for (const [key, value] of Object.entries(patch)) {
    const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
    const nextLine = `${key}=${value}`;
    if (idx >= 0) {
      lines[idx] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  const nextContent = lines.join('\n').replace(/\n*$/, '\n');
  fs.writeFileSync(ENV_PATH, nextContent, 'utf8');
}

module.exports = {
  CONFIG_KEYS,
  DEFAULTS,
  getRuntimeConfig,
  updateRuntimeConfig,
};
