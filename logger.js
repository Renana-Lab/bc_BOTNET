<<<<<<< HEAD
// logger.js
=======
// src/logger.js
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
const winston = require('winston');
const path = require('path');
const fs = require('fs');

<<<<<<< HEAD
const logDir = path.resolve(__dirname, 'logs');
=======
const logDir = path.resolve('./logs');
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
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
<<<<<<< HEAD
          const extras = Object.keys(meta).length ? '  ' + JSON.stringify(meta) : '';
=======
          const extras = Object.keys(meta).length ? '  ' + JSON.stringify(meta, null, 0) : '';
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
          return `[${timestamp}] ${level}: ${message}${extras}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
