// listener.js — WebSocket real-time event listener
const { Web3 } = require('web3');
const path = require('path');
const logger = require('./logger');
const { getAccount } = require('./chain');

const CampaignFactoryABI = require(path.join(__dirname, 'abis', 'CampaignFactory.json')).abi;
const CampaignABI        = require(path.join(__dirname, 'abis', 'Campaign.json')).abi;

const FACTORY_ADDRESS = process.env.FACTORY_SOCKET_ADDRESS
  || process.env.FACTORY_ADDRESS
  || '0xCf77A40535908Ae58c687A4A77D21259822968B8';

let web3ws = null;
let factoryWs = null;
const subscriptions = [];
const listenedAddresses = new Set();

async function startListening(onNewBid = null) {
  const wsUrl = process.env.RPC_WS;
  if (!wsUrl || wsUrl.includes('YOUR_INFURA')) {
    logger.warn('RPC_WS not set — skipping real-time listener');
    return;
  }

  logger.info('🔌 Connecting WebSocket listener...');
  web3ws    = new Web3(new Web3.providers.WebsocketProvider(wsUrl));
  factoryWs = new web3ws.eth.Contract(CampaignFactoryABI, FACTORY_ADDRESS);

  try {
    const addresses = await factoryWs.methods.getDeployedCampaigns().call();
    addresses.forEach(addr => _subscribeCampaign(addr, onNewBid));
    logger.info(`Subscribed to ${addresses.length} existing campaigns`);
  } catch (err) {
    logger.warn('Could not fetch campaigns for WS', { error: err.message });
  }

  try {
    factoryWs.events.AuctionCreated()
      .on('data', (event) => {
        const addr = event.returnValues.campaignAddress;
        logger.info(`📢 New auction: ${addr}`);
        _subscribeCampaign(addr, onNewBid);
      });
  } catch (_) {}

  logger.info('✅ WebSocket listener active');
}

function _subscribeCampaign(address, onNewBid) {
  if (listenedAddresses.has(address.toLowerCase())) return;
  listenedAddresses.add(address.toLowerCase());
  const me = getAccount().address.toLowerCase();
  const campaign = new web3ws.eth.Contract(CampaignABI, address);
  const short = address.slice(0,10) + '…';

  try {
    campaign.events.BidAdded().on('data', (e) => {
      const c = e.returnValues.contributor;
      logger.info(`🔨 BidAdded on ${short} by ${c}${c?.toLowerCase()===me?' ← YOU':''}`);
      if (onNewBid) onNewBid(address, c, e);
    });
  } catch (_) {}

  try {
    campaign.events.SellerPaid().on('data', (e) => {
      const { seller, amount } = e.returnValues;
      if (seller?.toLowerCase() === me)
        logger.info(`💵 YOU were paid ${amount} wei from ${short}`);
    });
  } catch (_) {}

  try {
    campaign.events.RefundProcessed().on('data', (e) => {
      if (e.returnValues.contributor?.toLowerCase() === me)
        logger.info(`↩️  YOU were refunded ${e.returnValues.amount} wei from ${short}`);
    });
  } catch (_) {}
}

async function stopListening() {
  for (const sub of subscriptions) {
    try { sub.unsubscribe && await sub.unsubscribe(); } catch (_) {}
  }
  if (web3ws?.currentProvider?.disconnect) web3ws.currentProvider.disconnect();
}

module.exports = { startListening, stopListening };
