require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const { Web3 } = require('web3');
const path = require('path');
const logger = require('./logger');

const CampaignFactoryABI = require(path.join(__dirname, 'abis', 'CampaignFactory.json')).abi;
const CampaignABI = require(path.join(__dirname, 'abis', 'Campaign.json')).abi;

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

async function init() {
  const privateKey = requireEnv('PRIVATE_KEY');
  const rpcHttp = requireEnv('RPC_HTTP');
  factoryAddress = process.env.FACTORY_ADDRESS || '0xb61Cd17D498f82E9F22771254C31bCBBb5781540';

  web3 = new Web3(new Web3.providers.HttpProvider(rpcHttp, { timeout: 30000 }));
  web3.eth.handleRevert = true;

  account = web3.eth.accounts.privateKeyToAccount(privateKey);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;

  let chainId;
  let balance;
  try {
    chainId = await retryRpc(() => web3.eth.getChainId());
    nonce = Number(await retryRpc(() => web3.eth.getTransactionCount(account.address, 'pending')));
    balance = await retryRpc(() => web3.eth.getBalance(account.address));
  } catch (err) {
    throw new Error(`Cannot connect to Ethereum RPC: ${err.message}`);
  }

  const expectedChainId = BigInt(process.env.CHAIN_ID || '11155111');
  if (chainId !== expectedChainId) {
    throw new Error(`Wrong network. Expected ${expectedChainId}, got ${chainId}`);
  }

  factory = new web3.eth.Contract(CampaignFactoryABI, factoryAddress);
  factory.handleRevert = true;

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
  });

  return { web3, account, factory };
}

async function buildTxParams(extra = {}) {
  const gasPrice = await web3.eth.getGasPrice();
  const bumpedGasPrice = (BigInt(gasPrice) * 120n / 100n).toString();
  const txNonce = nonce++;
  return { from: account.address, gasPrice: bumpedGasPrice, nonce: txNonce, ...extra };
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

async function retryRpc(fn, attempts = 6, delayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
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
};
