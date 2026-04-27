const { Web3 } = require('web3');
const path = require('path');
const logger = require('../config/logger');
const { getAccount } = require('../chain');
const { abisDir } = require('../paths');

const CampaignFactoryABI = require(path.join(abisDir, 'CampaignFactory.json')).abi;
const CampaignABI = require(path.join(abisDir, 'Campaign.json')).abi;

const FACTORY_ADDRESS = process.env.FACTORY_SOCKET_ADDRESS
  || process.env.FACTORY_ADDRESS
  || '0xCf77A40535908Ae58c687A4A77D21259822968B8';

let web3ws = null;
let factoryWs = null;
let onNewBidCallback = null;
const subscriptions = [];
const listenedAddresses = new Set();

async function startListening(onNewBid = null) {
  const wsUrl = process.env.RPC_WS;
  if (!wsUrl || wsUrl.includes('YOUR_INFURA')) {
    logger.warn('RPC_WS not configured - skipping real-time listener');
    return;
  }

  onNewBidCallback = onNewBid;
  web3ws = new Web3(new Web3.providers.WebsocketProvider(wsUrl));
  factoryWs = new web3ws.eth.Contract(CampaignFactoryABI, FACTORY_ADDRESS);

  try {
    const addresses = await factoryWs.methods.getDeployedCampaigns().call();
    for (const address of addresses) {
      subscribeCampaign(address);
    }
    logger.info(`Subscribed to ${addresses.length} existing campaigns`);
  } catch (err) {
    logger.warn('Could not fetch campaigns for WebSocket listener', { error: err.message });
  }

  try {
    const sub = factoryWs.events.AuctionCreated()
      .on('data', (event) => {
        const address = event.returnValues.campaignAddress;
        logger.info(`New auction detected: ${address}`);
        subscribeCampaign(address);
      });
    subscriptions.push(sub);
  } catch (err) {
    logger.warn('Could not subscribe to AuctionCreated', { error: err.message });
  }

  logger.info('WebSocket listener active');
}

function subscribeCampaign(address) {
  const lower = address.toLowerCase();
  if (listenedAddresses.has(lower)) return;
  listenedAddresses.add(lower);

  const me = getAccount().address.toLowerCase();
  const campaign = new web3ws.eth.Contract(CampaignABI, address);
  const short = `${address.slice(0, 10)}...`;

  try {
    const sub = campaign.events.BidAdded().on('data', (event) => {
      const contributor = event.returnValues.contributor;
      logger.info(`BidAdded on ${short} by ${contributor}${contributor?.toLowerCase() === me ? ' <- YOU' : ''}`);
      if (onNewBidCallback) onNewBidCallback(address, contributor, event);
    });
    subscriptions.push(sub);
  } catch (_) {}

  try {
    const sub = campaign.events.SellerPaid().on('data', (event) => {
      const { seller, amount } = event.returnValues;
      if (seller?.toLowerCase() === me) {
        logger.info(`You were paid ${amount} wei from ${short}`);
      }
    });
    subscriptions.push(sub);
  } catch (_) {}

  try {
    const sub = campaign.events.RefundProcessed().on('data', (event) => {
      const { contributor, amount } = event.returnValues;
      if (contributor?.toLowerCase() === me) {
        logger.info(`You were refunded ${amount} wei from ${short}`);
      }
    });
    subscriptions.push(sub);
  } catch (_) {}
}

async function stopListening() {
  for (const sub of subscriptions) {
    try {
      if (sub.unsubscribe) await sub.unsubscribe();
    } catch (_) {}
  }
  if (web3ws?.currentProvider?.disconnect) {
    web3ws.currentProvider.disconnect();
  }
}

module.exports = { startListening, stopListening };
