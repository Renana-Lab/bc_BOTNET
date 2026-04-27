const logger = require('./logger');

let installed = false;

function installProcessGuards() {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    if (logRecoverableTransactionTimeout(reason, 'Unhandled transaction timeout')) {
      return;
    }
    logger.error('Unhandled promise rejection', {
      error: formatError(reason),
      stack: reason?.stack,
    });
  });

  process.on('uncaughtException', (err) => {
    if (logRecoverableTransactionTimeout(err, 'Uncaught transaction timeout')) {
      return;
    }
    logger.error('Uncaught exception', {
      error: formatError(err),
      stack: err?.stack,
    });
    process.exit(1);
  });
}

function logRecoverableTransactionTimeout(err, label) {
  if (!isRecoverableTransactionTimeout(err)) {
    return false;
  }

  logger.warn(`${label}; transaction may still be pending or mined`, {
    tx: extractTransactionHash(err) || 'unknown',
    error: formatError(err),
  });
  return true;
}

function isRecoverableTransactionTimeout(err) {
  const message = formatError(err).toLowerCase();
  return (
    err?.code === 431
    || err?.name === 'TransactionSendTimeoutError'
    || message.includes('transaction hash:')
    || message.includes('node did not respond')
    || message.includes('not mined within')
  );
}

function extractTransactionHash(err) {
  const candidates = [
    err?.transactionHash,
    err?.receipt?.transactionHash,
    err?.data?.transactionHash,
    err?.cause?.transactionHash,
    err?.cause?.receipt?.transactionHash,
  ];

  for (const candidate of candidates) {
    if (candidate) return String(candidate);
  }

  const message = [
    err?.message,
    err?.cause?.message,
    err?.data?.message,
  ].filter(Boolean).join('\n');
  const match = message.match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : null;
}

function formatError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err?.message || String(err);
}

module.exports = { installProcessGuards };
