// src/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.resolve('./logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const fmt = winston.format;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fmt.combine(fmt.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), fmt.errors({ stack: true }), fmt.json()),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'bot.log') }),
    new winston.transports.Console({
      format: fmt.combine(
        fmt.colorize(),
        fmt.timestamp({ format: 'HH:mm:ss' }),
        fmt.printf(({ timestamp, level, message, ...meta }) => {
          const extras = Object.keys(meta).length ? '  ' + JSON.stringify(meta, null, 0) : '';
          return `[${timestamp}] ${level}: ${message}${extras}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
