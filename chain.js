require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const { Web3 } = require('web3');
const path = require('path');
const logger = require('./logger');

const CampaignFactoryABI = require(path.join(__dirname, 'abis', 'CampaignFactory.json')).abi;
const CampaignABI = require(path.join(__dirname, 'abis', 'Campaign.json')).abi;

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

  logger.info('Chain initialized', {
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

module.exports = {
  init,
  getCampaign,
  weiToEth,
  buildTxParams,
  resyncNonce,
  retryRpc,
  unwrapError,
  getWeb3,
  getAccount,
  getFactory,
  getFactoryAddress,
  getExpectedChainId,
};
