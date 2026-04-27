const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');
const { dataDir } = require('../paths');
const { createAuction } = require('./seller');

const schedulePath = path.join(dataDir, 'selling-schedule.json');

function loadSellingSchedule() {
  ensureScheduleFile();
  try {
    const raw = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.items;
    return normalizeSchedule(Array.isArray(items) ? items : []);
  } catch (err) {
    logger.warn('Selling schedule could not be loaded, starting empty', { error: err.message });
    return [];
  }
}

function saveSellingSchedule(items = []) {
  const normalized = normalizeSchedule(items);
  ensureScheduleFile();
  fs.writeFileSync(schedulePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

async function runDueScheduledAuctions(options = {}) {
  if (process.env.SELLING_SCHEDULE_ENABLED !== 'true' && options.force !== true) {
    return [];
  }

  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : Number.MAX_SAFE_INTEGER;
  const schedule = loadSellingSchedule();
  const due = schedule
    .filter((item) => item.enabled !== false && item.status !== 'created' && new Date(item.startAt).getTime() <= nowMs)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, limit);

  if (!due.length) {
    logger.info('Selling schedule healthy - no due auctions');
    return [];
  }

  logger.ascii('seller schedule', [
    `due ${due.length}`,
    `file ${path.basename(schedulePath)}`,
  ], {
    message: `Selling schedule launching ${due.length} auction(s)`,
  });

  const results = [];
  for (const dueItem of due) {
    const index = schedule.findIndex((item) => item.id === dueItem.id);
    try {
      logger.info(`Scheduled auction due: "${dueItem.dataDescription}"`, {
        startAt: dueItem.startAt,
        minBidWei: String(dueItem.minimumContribution),
        durationMin: String(dueItem.auctionDuration),
      });
      const result = await createAuction(dueItem);
      const updated = {
        ...schedule[index],
        status: 'created',
        createdAt: new Date().toISOString(),
        createdAddress: result.newAddress || '',
        error: '',
        attempts: Number(schedule[index].attempts || 0) + 1,
      };
      schedule[index] = updated;
      results.push({ item: publicScheduleItem(updated), success: true, ...result });
    } catch (err) {
      const updated = {
        ...schedule[index],
        status: 'failed',
        error: err.message,
        attempts: Number(schedule[index].attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
      };
      schedule[index] = updated;
      logger.error(`Scheduled auction failed: "${dueItem.dataDescription}"`, { error: err.message });
      results.push({ item: publicScheduleItem(updated), success: false, error: err.message });
    }
    saveSellingSchedule(schedule);
    await sleep(1500);
  }

  return results;
}

function buildBlankSellingSchedule(count = 10) {
  const safeCount = Math.max(1, Math.min(50, Number(count || 10)));
  const now = Date.now();
  return Array.from({ length: safeCount }, (_, index) => normalizeScheduleItem({
    id: makeId(),
    enabled: true,
    startAt: new Date(now + (index * 5 * 60 * 1000)).toISOString(),
    minimumContribution: 100 + (index * 25),
    auctionDuration: 10,
    dataDescription: `Scheduled dataset #${index + 1}`,
    dataForSell: `ipfs://scheduled/dataset-${index + 1}.json`,
    status: 'pending',
  }));
}

function normalizeSchedule(items) {
  return items.map(normalizeScheduleItem).map(publicScheduleItem);
}

function normalizeScheduleItem(item = {}) {
  const startAt = normalizeDate(item.startAt || item.startTime || item.startsAt);
  const created = String(item.status || '').toLowerCase() === 'created';
  const failed = String(item.status || '').toLowerCase() === 'failed';

  return {
    id: String(item.id || makeId()),
    enabled: item.enabled !== false && String(item.enabled) !== 'false',
    startAt,
    startAtMs: new Date(startAt).getTime(),
    minimumContribution: Math.max(1, Math.floor(Number(item.minimumContribution || item.minBidWei || 100))),
    auctionDuration: Math.max(1, Math.min(30, Math.floor(Number(item.auctionDuration || item.durationMin || 10)))),
    dataDescription: String(item.dataDescription || item.description || '').trim(),
    dataForSell: String(item.dataForSell || item.payload || '').trim(),
    status: created ? 'created' : failed ? 'failed' : 'pending',
    createdAt: item.createdAt || '',
    createdAddress: item.createdAddress || '',
    lastAttemptAt: item.lastAttemptAt || '',
    attempts: Math.max(0, Math.floor(Number(item.attempts || 0))),
    error: item.error || '',
  };
}

function publicScheduleItem(item) {
  const { startAtMs, ...publicItem } = item;
  return publicItem;
}

function normalizeDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function ensureScheduleFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(schedulePath)) {
    fs.writeFileSync(schedulePath, '[]\n', 'utf8');
  }
}

function makeId() {
  return `sale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  buildBlankSellingSchedule,
  loadSellingSchedule,
  runDueScheduledAuctions,
  saveSellingSchedule,
  schedulePath,
};
