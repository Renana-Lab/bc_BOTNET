require('dotenv').config({ path: require('../paths').envPath });

const { Web3 } = require('web3');
const path = require('path');
const logger = require('../config/logger');
const { abisDir } = require('../paths');

const CampaignFactoryABI = require(path.join(abisDir, 'CampaignFactory.json')).abi;
const CampaignABI = require(path.join(abisDir, 'Campaign.json')).abi;

const DEFAULT_HTTP_FALLBACKS = [
  'https://sepolia.infura.io/v3/6426761d274542bb9652e9a5aff35a0c',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.startsWith('YOUR') || value === '0xYourPrivateKeyHere') {
    throw new Error(`Missing required env value: ${name}`);
  }
  return value;
}

let web3;
let account;
let privateKeyForSigning;
let factory;
let factoryAddress;
let nonce = null;
let rpcHttpCandidates = [];
let activeRpcIndex = 0;
let lastRpcSwitchAt = 0;
let expectedChainId = 11155111n;

const RPC_ROTATION_COOLDOWN_MS = 60000;

async function init() {
  const privateKey = requireEnv('PRIVATE_KEY');
  privateKeyForSigning = privateKey;
  rpcHttpCandidates = buildRpcCandidates();
  if (rpcHttpCandidates.length === 0) {
    throw new Error('Missing required env value: RPC_HTTP');
  }
  factoryAddress = process.env.FACTORY_ADDRESS || '0xb61Cd17D498f82E9F22771254C31bCBBb5781540';

  account = new Web3().eth.accounts.privateKeyToAccount(privateKey);
  connectHttpProvider(rpcHttpCandidates[0]);
  attachAccount();

  let chainId;
  let balance;
  try {
    chainId = await retryRpc(() => web3.eth.getChainId(), 8, 600);
    nonce = Number(await retryRpc(() => web3.eth.getTransactionCount(account.address, 'pending'), 8, 600));
    balance = await retryRpc(() => web3.eth.getBalance(account.address), 8, 600);
  } catch (err) {
    throw new Error(`Cannot connect to Ethereum RPC: ${err.message}`);
  }

  expectedChainId = BigInt(process.env.CHAIN_ID || '11155111');
  if (chainId !== expectedChainId) {
    throw new Error(`Wrong network. Expected ${expectedChainId}, got ${chainId}`);
  }

  bindFactory();

  try {
    const code = await web3.eth.getCode(factoryAddress);
    if (code === '0x') {
      logger.warn(`No contract code found at factory address ${factoryAddress}`);
    }
  } catch (_) {}

  logger.ascii('chain online', [
    `wallet  ${account.address.slice(0, 10)}...${account.address.slice(-6)}`,
    `chain   ${chainId.toString()}`,
    `nonce   ${nonce}`,
  ], {
    address: account.address,
    chainId: chainId.toString(),
    balanceETH: Number(web3.utils.fromWei(balance.toString(), 'ether')).toFixed(6),
    factory: factoryAddress,
    nonce,
    rpc: rpcHttpCandidates[activeRpcIndex],
  });

  return { web3, account, factory };
}

async function buildTxParams(extra = {}) {
  const pendingNonce = Number(await retryRpc(() => web3.eth.getTransactionCount(account.address, 'pending'), 6, 500));
  nonce = nonce === null ? pendingNonce : Math.max(nonce, pendingNonce);
  const gasPrice = await retryRpc(() => web3.eth.getGasPrice(), 6, 500);
  const bumpedGasPrice = (BigInt(gasPrice) * 120n / 100n).toString();
  const txNonce = nonce++;
  return {
    from: account.address,
    gasPrice: bumpedGasPrice,
    nonce: txNonce,
    chainId: Number(expectedChainId),
    ...extra,
  };
}

async function resyncNonce() {
  nonce = Number(await web3.eth.getTransactionCount(account.address, 'pending'));
  logger.debug(`Nonce resynced -> ${nonce}`);
}

function unwrapError(err) {
  if (!err) return 'Unknown error';
  const candidates = [
    err?.cause?.message,
    err?.data?.message,
    err?.innerError?.message,
    err?.reason,
    err?.message,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim() && candidate.trim() !== 'Returned error: ') {
      return candidate.trim();
    }
  }
  try {
    const body = err?.cause?.cause?.body || err?.body;
    if (body) {
      const parsed = JSON.parse(body);
      return parsed?.error?.message || parsed?.message || JSON.stringify(parsed);
    }
  } catch (_) {}
  return String(err) || 'Unknown error';
}

function buildRpcCandidates() {
  const configured = [process.env.RPC_HTTP, process.env.ALTERNATE_RPC_HTTP]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const seen = new Set();
  return [...configured, ...DEFAULT_HTTP_FALLBACKS].filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function connectHttpProvider(url) {
  web3 = new Web3(new Web3.providers.HttpProvider(url, { timeout: 30000 }));
  web3.eth.handleRevert = true;
  web3.eth.transactionSendTimeout = Number(process.env.TX_SEND_TIMEOUT_SEC || '120');
  web3.eth.transactionPollingTimeout = Number(process.env.TX_RECEIPT_TIMEOUT_SEC || '120');
}

function attachAccount() {
  web3.eth.accounts.wallet.clear();
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;
}

function bindFactory() {
  factory = new web3.eth.Contract(CampaignFactoryABI, factoryAddress);
  factory.handleRevert = true;
}

async function rotateHttpProvider(reason = 'RPC fallback') {
  if (rpcHttpCandidates.length <= 1) {
    return false;
  }

  const now = Date.now();
  if (lastRpcSwitchAt && (now - lastRpcSwitchAt) < RPC_ROTATION_COOLDOWN_MS) {
    return false;
  }

  const nextIndex = (activeRpcIndex + 1) % rpcHttpCandidates.length;
  if (nextIndex === activeRpcIndex) {
    return false;
  }

  activeRpcIndex = nextIndex;
  lastRpcSwitchAt = now;
  connectHttpProvider(rpcHttpCandidates[activeRpcIndex]);
  attachAccount();
  bindFactory();
  logger.warn(`${reason}; switched HTTP RPC`, { rpc: rpcHttpCandidates[activeRpcIndex] });
  return true;
}

function shouldRotateRpc(err) {
  const message = unwrapError(err).toLowerCase();
  return (
    message.includes('429')
    || message.includes('too many requests')
    || message.includes('rate limit')
    || message.includes('throttle')
    || message.includes('returned error:')
    || message.includes('internal error')
  );
}

function getCampaign(address) {
  if (!web3) throw new Error('Chain not initialized - call init() first');
  const campaign = new web3.eth.Contract(CampaignABI, address);
  campaign.handleRevert = true;
  return campaign;
}

function weiToEth(wei) {
  return Number(web3.utils.fromWei(String(wei), 'ether')).toFixed(8);
}

function getWeb3() { return web3; }
function getAccount() { return account; }
function getFactory() { return factory; }
function getFactoryAddress() { return factoryAddress; }
function getExpectedChainId() { return Number(expectedChainId); }

async function retryRpc(fn, attempts = 6, delayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (shouldRotateRpc(err) && attempt < attempts) {
        await rotateHttpProvider('Primary RPC rejected request');
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

function isPendingTransactionTimeout(err) {
  const message = unwrapError(err).toLowerCase();
  return (
    err?.code === 431
    || err?.name === 'TransactionSendTimeoutError'
    || message.includes('transactionsendtimeouterror')
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
    const normalized = normalizeTransactionHash(candidate);
    if (normalized) return normalized;
  }

  const message = [
    err?.message,
    err?.cause?.message,
    err?.data?.message,
  ].filter(Boolean).join('\n');
  const match = message.match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : null;
}

async function sendContractTransaction(contractMethod, txParams, context = {}) {
  const rawTx = {
    ...txParams,
    data: contractMethod.encodeABI(),
  };

  const signed = await web3.eth.accounts.signTransaction(rawTx, privateKeyForSigning);
  if (!signed.rawTransaction) {
    throw new Error('Failed to sign transaction');
  }

  const expectedHash = normalizeTransactionHash(signed.transactionHash);
  const txHash = normalizeTransactionHash(await retryRpc(
    () => sendRawTransaction(signed.rawTransaction, expectedHash),
    Number(process.env.TX_SEND_RPC_ATTEMPTS || '4'),
    Number(process.env.TX_SEND_RPC_RETRY_MS || '1500')
  )) || expectedHash;

  if (!txHash) {
    throw new Error('Transaction submitted but no transaction hash was returned');
  }

  logger.ascii('tx submitted', [
    `action  ${context.action || 'contract'}`,
    // `hash    ${txHash.slice(0, 12)}...${txHash.slice(-8)}`,
  ], { ...context, tx: txHash });
  watchReceiptInBackground(txHash, context);

  return {
    transactionHash: txHash,
    pending: true,
    submittedOnly: true,
  };
}

async function sendRawTransaction(rawTransaction, expectedHash = null) {
  const provider = web3.currentProvider;
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('Current provider does not support raw RPC requests');
  }

  try {
    return normalizeTransactionHash(await provider.request({
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: [rawTransaction],
      id: Date.now(),
    }));
  } catch (err) {
    const message = unwrapError(err).toLowerCase();
    if (expectedHash && (
      message.includes('already known')
      || message.includes('known transaction')
      || message.includes('already imported')
    )) {
      return expectedHash;
    }
    throw err;
  }
}

function watchReceiptInBackground(txHash, context = {}) {
  txHash = normalizeTransactionHash(txHash);
  if (!txHash) return;

  if (process.env.TX_BACKGROUND_RECEIPT_CHECK === 'false') {
    return;
  }

  const attempts = Number(process.env.TX_RECEIPT_CHECK_ATTEMPTS || '5');
  const delayMs = Number(process.env.TX_RECEIPT_CHECK_MS || '15000');

  (async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      try {
        const receipt = await web3.eth.getTransactionReceipt(txHash);
        if (receipt) {
          logger.ascii('tx mined', [
            `action  ${context.action || 'contract'}`,
            // `hash    ${txHash.slice(0, 12)}...${txHash.slice(-8)}`,
          ], {
            ...context,
            tx: txHash,
            blockNumber: receipt.blockNumber?.toString?.() || String(receipt.blockNumber || ''),
            status: receipt.status?.toString?.() || String(receipt.status ?? ''),
          });
          return;
        }
      } catch (err) {
        if (shouldRotateRpc(err)) {
          await rotateHttpProvider('Receipt check RPC rejected request');
        }
        logger.debug('Receipt check delayed', {
          ...context,
          tx: txHash,
          attempt,
          error: unwrapError(err),
        });
      }
    }
  })().catch((err) => {
    logger.debug('Receipt watcher stopped', { ...context, tx: txHash, error: unwrapError(err) });
  });
}

function normalizeTransactionHash(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidates = [
      value.transactionHash,
      value.result,
      value.hash,
      value.txHash,
      value.receipt?.transactionHash,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeTransactionHash(candidate);
      if (normalized) return normalized;
    }
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const text = value.toString();
      if (text && text !== '[object Object]') return text;
    }
  }
  return String(value);
}

module.exports = {
  init,
  getCampaign,
  weiToEth,
  buildTxParams,
  resyncNonce,
  retryRpc,
  sendContractTransaction,
  normalizeTransactionHash,
  unwrapError,
  getWeb3,
  getAccount,
  getFactory,
  getFactoryAddress,
  getExpectedChainId,
};
