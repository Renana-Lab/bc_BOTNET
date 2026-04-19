// src/chain.js
// Sets up Web3, wallet account, and both factory contract instances.
// All other modules import from here — single source of truth.

const { Web3 } = require('web3');
const path = require('path');
const logger = require('./logger');

const CampaignFactoryABI = require(path.resolve('./abis/CampaignFactory.json')).abi;
const CampaignABI        = require(path.resolve('./abis/Campaign.json')).abi;

// ── Validate env ────────────────────────────────────────────────
function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.startsWith('YOUR') || v === '0xYourPrivateKeyHere') {
    throw new Error(`Missing or placeholder env var: ${name}`);
  }
  return v;
}

let web3, account, factory, factoryAddress;

async function init() {
  const privateKey     = requireEnv('PRIVATE_KEY');
  const rpcHttp        = requireEnv('RPC_HTTP');
  factoryAddress       = process.env.FACTORY_ADDRESS || '0xb61Cd17D498f82E9F22771254C31bCBBb5781540';

  web3 = new Web3(rpcHttp);

  // Add wallet
  account = web3.eth.accounts.privateKeyToAccount(privateKey);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;

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
  });

  return { web3, account, factory };
}

// Returns a Campaign contract instance for a given address
function getCampaign(address) {
  if (!web3) throw new Error('Chain not initialized — call init() first');
  return new web3.eth.Contract(CampaignABI, address);
}

// Convert Wei bigint/string to human-readable
function weiToEth(wei) {
  return Number(web3.utils.fromWei(String(wei), 'ether')).toFixed(8);
}

function getWeb3()    { return web3; }
function getAccount() { return account; }
function getFactory() { return factory; }
function getFactoryAddress() { return factoryAddress; }

module.exports = { init, getCampaign, weiToEth, getWeb3, getAccount, getFactory, getFactoryAddress };
