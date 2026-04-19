// src/listener.js
// Listens to on-chain events in real time via WebSocket.
// Mirrors exactly what AuctionsListPage.js does with factorySocket / web3Socket.
//
// Events listened:
//   CampaignFactory → AuctionCreated(campaignAddress)
//   CampaignFactory → BudgetUpdated(user, newBudget)
//   Campaign        → BidAdded(contributor)
//   Campaign        → SellerPaid(seller, amount)
//   Campaign        → RefundProcessed(contributor, amount)

const { Web3 } = require('web3');
const path = require('path');
const logger = require('./logger');
const { getAccount } = require('./chain');

const CampaignFactoryABI = require(path.resolve('./abis/CampaignFactory.json')).abi;
const CampaignABI        = require(path.resolve('./abis/Campaign.json')).abi;

const FACTORY_ADDRESS = process.env.FACTORY_SOCKET_ADDRESS
  || process.env.FACTORY_ADDRESS
  || '0xCf77A40535908Ae58c687A4A77D21259822968B8';

let web3ws = null;
let factoryWs = null;
const subscriptions = [];
const listenedAddresses = new Set();
let onNewBidCallback = null;  // external hook — set by autotrader

/**
 * Start the WebSocket listener.
 * @param {function} onNewBid  — called when any BidAdded fires: (auctionAddress, contributor, event)
 */
async function startListening(onNewBid = null) {
  const wsUrl = process.env.RPC_WS;
  if (!wsUrl || wsUrl.includes('YOUR_INFURA')) {
    logger.warn('RPC_WS not configured — skipping real-time event listener');
    return;
  }

  onNewBidCallback = onNewBid;

  logger.info('🔌 Connecting WebSocket listener...', { url: wsUrl.replace(/\/v3\/.+/, '/v3/***') });

  web3ws = new Web3(new Web3.providers.WebsocketProvider(wsUrl));
  factoryWs = new web3ws.eth.Contract(CampaignFactoryABI, FACTORY_ADDRESS);

  // Listen to factory-level events
  await _subscribeFactory();

  // Subscribe to all already-deployed campaigns
  try {
    const addresses = await factoryWs.methods.getDeployedCampaigns().call();
    logger.info(`Subscribing to events on ${addresses.length} existing campaigns`);
    for (const addr of addresses) {
      _subscribeCampaign(addr);
    }
  } catch (err) {
    logger.warn('Could not fetch deployed campaigns for WS subscription', { error: err.message });
  }

  logger.info('✅ WebSocket listener active');
}

async function _subscribeFactory() {
  // New auction created
  try {
    const sub = factoryWs.events.AuctionCreated()
      .on('data', (event) => {
        const addr = event.returnValues.campaignAddress;
        logger.info(`📢 [EVENT] New auction created: ${addr}`);
        _subscribeCampaign(addr); // auto-subscribe to the new campaign
      })
      .on('error', (err) => logger.error('AuctionCreated event error', { error: err.message }));
    subscriptions.push(sub);
  } catch (err) {
    logger.warn('Could not subscribe to AuctionCreated', { error: err.message });
  }

  // Budget updated for our wallet
  const me = getAccount().address.toLowerCase();
  try {
    const sub = factoryWs.events.BudgetUpdated()
      .on('data', (event) => {
        const { user, newBudget } = event.returnValues;
        if (String(user).toLowerCase() === me) {
          logger.info(`💸 [EVENT] Your budget updated: ${newBudget} wei`);
        }
      })
      .on('error', (err) => logger.error('BudgetUpdated event error', { error: err.message }));
    subscriptions.push(sub);
  } catch (err) {
    logger.warn('Could not subscribe to BudgetUpdated', { error: err.message });
  }
}

function _subscribeCampaign(address) {
  if (listenedAddresses.has(address.toLowerCase())) return;
  listenedAddresses.add(address.toLowerCase());

  const me = getAccount().address.toLowerCase();
  const campaign = new web3ws.eth.Contract(CampaignABI, address);
  const short = address.slice(0, 10) + '…';

  // BidAdded — someone placed a bid
  try {
    const sub = campaign.events.BidAdded()
      .on('data', (event) => {
        const contributor = event.returnValues.contributor;
        const isMe = contributor?.toLowerCase() === me;
        logger.info(`🔨 [EVENT] BidAdded on ${short} by ${contributor}${isMe ? ' ← YOU' : ''}`);
        if (onNewBidCallback) onNewBidCallback(address, contributor, event);
      })
      .on('error', (err) => logger.debug(`BidAdded error on ${short}`, { error: err.message }));
    subscriptions.push(sub);
  } catch (_) {}

  // SellerPaid — auction finalized, seller received funds
  try {
    const sub = campaign.events.SellerPaid()
      .on('data', (event) => {
        const { seller, amount } = event.returnValues;
        const isMe = seller?.toLowerCase() === me;
        logger.info(`💵 [EVENT] SellerPaid on ${short}: ${amount} wei to ${seller}${isMe ? ' ← YOU' : ''}`);
      })
      .on('error', (err) => logger.debug(`SellerPaid error on ${short}`, { error: err.message }));
    subscriptions.push(sub);
  } catch (_) {}

  // RefundProcessed — loser was refunded
  try {
    const sub = campaign.events.RefundProcessed()
      .on('data', (event) => {
        const { contributor, amount } = event.returnValues;
        const isMe = contributor?.toLowerCase() === me;
        if (isMe) {
          logger.info(`↩️  [EVENT] You were refunded ${amount} wei from ${short}`);
        }
      })
      .on('error', (err) => logger.debug(`RefundProcessed error on ${short}`, { error: err.message }));
    subscriptions.push(sub);
  } catch (_) {}
}

async function stopListening() {
  logger.info('Closing WebSocket subscriptions...');
  for (const sub of subscriptions) {
    try { sub.unsubscribe && await sub.unsubscribe(); } catch (_) {}
  }
  if (web3ws?.currentProvider?.disconnect) {
    web3ws.currentProvider.disconnect();
  }
  logger.info('WebSocket listener closed');
}

module.exports = { startListening, stopListening };
