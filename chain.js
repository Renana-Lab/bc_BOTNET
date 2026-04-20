<<<<<<< HEAD
// chain.js — Web3 provider, wallet, factory contract
// FIX: uses __dirname so paths work regardless of where node is run from
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
=======
// src/chain.js
// Sets up Web3, wallet account, and both factory contract instances.
// All other modules import from here — single source of truth.
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a

const { Web3 } = require('web3');
const path = require('path');
const logger = require('./logger');

<<<<<<< HEAD
// ── Load ABIs from same folder as this file ──────────────────────
const CampaignFactoryABI = require(path.join(__dirname, 'abis', 'CampaignFactory.json')).abi;
const CampaignABI        = require(path.join(__dirname, 'abis', 'Campaign.json')).abi;

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.startsWith('YOUR') || v === '0xYourPrivateKeyHere') {
    throw new Error(
      `\n\n❌  Missing .env value: ${name}\n` +
      `    Copy .env.example to .env and fill in your details.\n`
    );
=======
const CampaignFactoryABI = require(path.resolve('./abis/CampaignFactory.json')).abi;
const CampaignABI        = require(path.resolve('./abis/Campaign.json')).abi;

// ── Validate env ────────────────────────────────────────────────
function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.startsWith('YOUR') || v === '0xYourPrivateKeyHere') {
    throw new Error(`Missing or placeholder env var: ${name}`);
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
  }
  return v;
}

let web3, account, factory, factoryAddress;
<<<<<<< HEAD
let _nonce = null;

async function init() {
  const privateKey   = requireEnv('PRIVATE_KEY');
  const rpcHttp      = requireEnv('RPC_HTTP');
  factoryAddress     = process.env.FACTORY_ADDRESS || '0xb61Cd17D498f82E9F22771254C31bCBBb5781540';

  web3 = new Web3(new Web3.providers.HttpProvider(rpcHttp, { timeout: 30000 }));
  web3.eth.handleRevert = true;

=======

async function init() {
  const privateKey     = requireEnv('PRIVATE_KEY');
  const rpcHttp        = requireEnv('RPC_HTTP');
  factoryAddress       = process.env.FACTORY_ADDRESS || '0xb61Cd17D498f82E9F22771254C31bCBBb5781540';

  web3 = new Web3(rpcHttp);

  // Add wallet
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
  account = web3.eth.accounts.privateKeyToAccount(privateKey);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;

<<<<<<< HEAD
  let chainId, nonce, balance;
  try {
    chainId = await web3.eth.getChainId();
    nonce = Number(await web3.eth.getTransactionCount(account.address, 'pending'));
    balance = await web3.eth.getBalance(account.address);
  } catch (err) {
    const msg = err.message || String(err);
    logger.error('\n❌ RPC CONNECTION FAILED');
    logger.error(`   ${msg}`);
    logger.error('\n📋 SOLUTIONS:');
    logger.error('   1. The Infura API key in .env may be rate-limited or invalid');
    logger.error('   2. Get your own free Infura key:');
    logger.error('      → Go to https://www.infura.io/dash/register');
    logger.error('      → Create project for Sepolia');
    logger.error('      → Copy HTTPS and WebSocket endpoints');
    logger.error('   3. Update RPC_HTTP and RPC_WS in .env');
    logger.error('\n   Alternative providers:');
    logger.error('   • Alchemy: https://www.alchemy.com (free tier available)');
    logger.error('   • QuickNode: https://quicknode.com (free tier available)');
    logger.error('   • Public RPC: https://www.infura.io/docs/communities/public-rpc\n');
    throw new Error('Cannot connect to Ethereum RPC. Check RPC_HTTP in .env');
  }

  const expectedChainId = BigInt(process.env.CHAIN_ID || '11155111');
  if (chainId !== expectedChainId) {
    throw new Error(
      `Wrong network! Expected chainId ${expectedChainId} (Sepolia), got ${chainId}.\n` +
      `Check RPC_HTTP in your .env file.`
    );
  }

  _nonce = nonce;

  factory = new web3.eth.Contract(CampaignFactoryABI, factoryAddress);
  factory.handleRevert = true;

  // Diagnostic: verify factory contract exists
  try {
    const factoryCode = await web3.eth.getCode(factoryAddress);
    if (factoryCode === '0x') {
      logger.warn(`⚠️  WARNING: No contract code at factory address ${factoryAddress}`);
      logger.warn(`   This address may be incorrect. Visit datamarketplaces.net to get the correct factory address.`);
    }
  } catch (e) {
    // RPC error, continue
  }

  logger.info('✅ Chain initialized', {
    address:    account.address,
    chainId:    chainId.toString(),
    balanceETH: Number(web3.utils.fromWei(balance.toString(), 'ether')).toFixed(6),
    factory:    factoryAddress,
    nonce:      _nonce,
=======
  // Verify network
  const chainId = await web3.eth.getChainId();
  const expectedChainId = BigInt(process.env.CHAIN_ID || '11155111');
  if (chainId !== expectedChainId) {
    throw new Error(`Wrong network! Expected chainId ${expectedChainId}, got ${chainId}. Are you on Sepolia?`);
  }

  // Factory contract
  factory = new web3.eth.Contract(CampaignFactoryABI, factoryAddress);

  const balance = await web3.eth.getBalance(account.address);
  logger.info('Chain client initialized', {
    address: account.address,
    chainId: chainId.toString(),
    balanceETH: Number(web3.utils.fromWei(balance, 'ether')).toFixed(6),
    factory: factoryAddress,
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
  });

  return { web3, account, factory };
}

<<<<<<< HEAD
async function buildTxParams(extra = {}) {
  const gasPrice = await web3.eth.getGasPrice();
  const gasPriceBumped = (BigInt(gasPrice) * 120n / 100n).toString();
  const nonce = _nonce++;
  return { from: account.address, gasPrice: gasPriceBumped, nonce, ...extra };
}

async function resyncNonce() {
  _nonce = Number(await web3.eth.getTransactionCount(account.address, 'pending'));
  logger.debug(`Nonce resynced → ${_nonce}`);
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
  for (const c of candidates) {
    if (c && c.trim() && c.trim() !== 'Returned error: ') return c.trim();
  }
  try {
    const body = err?.cause?.cause?.body || err?.body;
    if (body) {
      const p = JSON.parse(body);
      return p?.error?.message || p?.message || JSON.stringify(p);
    }
  } catch (_) {}
  return String(err) || 'Unknown error';
}

function getCampaign(address) {
  if (!web3) throw new Error('Chain not initialized — call init() first');
  const c = new web3.eth.Contract(CampaignABI, address);
  c.handleRevert = true;
  return c;
}

=======
// Returns a Campaign contract instance for a given address
function getCampaign(address) {
  if (!web3) throw new Error('Chain not initialized — call init() first');
  return new web3.eth.Contract(CampaignABI, address);
}

// Convert Wei bigint/string to human-readable
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
function weiToEth(wei) {
  return Number(web3.utils.fromWei(String(wei), 'ether')).toFixed(8);
}

<<<<<<< HEAD
function getWeb3()           { return web3; }
function getAccount()        { return account; }
function getFactory()        { return factory; }
function getFactoryAddress() { return factoryAddress; }

module.exports = {
  init, getCampaign, weiToEth,
  buildTxParams, resyncNonce, unwrapError,
  getWeb3, getAccount, getFactory, getFactoryAddress,
};
=======
function getWeb3()    { return web3; }
function getAccount() { return account; }
function getFactory() { return factory; }
function getFactoryAddress() { return factoryAddress; }

module.exports = { init, getCampaign, weiToEth, getWeb3, getAccount, getFactory, getFactoryAddress };
>>>>>>> fceb3ee0a64fd3207910a19e4b7d3ab9011c4c0a
