const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { logsDir } = require('../paths');

const logDir = logsDir;
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const fmt = winston.format;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fmt.combine(
    fmt.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    fmt.errors({ stack: true }),
    fmt.json()
  ),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'bot.log') }),
    new winston.transports.Console({
      format: fmt.combine(
        fmt.colorize(),
        fmt.timestamp({ format: 'HH:mm:ss' }),
        fmt.printf(({ timestamp, level, message, ...meta }) => {
          const extras = Object.keys(meta).length ? `  ${JSON.stringify(meta)}` : '';
          return `[${timestamp}] ${level}: ${message}${extras}`;
        })
      ),
    }),
  ],
});

function asciiBox(title, lines = []) {
  const cleanTitle = String(title || 'BOT').toUpperCase();
  const cleanLines = Array.isArray(lines) ? lines.map((line) => String(line)) : [String(lines)];
  const width = Math.max(24, cleanTitle.length, ...cleanLines.map((line) => line.length));
  const border = `+${'-'.repeat(width + 2)}+`;
  const pad = (value) => String(value).padEnd(width, ' ');

  return [
    '',
    border,
    `| ${pad(cleanTitle)} |`,
    ...cleanLines.filter(Boolean).map((line) => `| ${pad(line)} |`),
    border,
  ].join('\n');
}

logger.ascii = (title, lines = [], meta = {}) => {
  logger.info(asciiBox(title, lines), meta);
};

module.exports = logger;
