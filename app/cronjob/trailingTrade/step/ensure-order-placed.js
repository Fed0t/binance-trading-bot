const config = require('config');
const moment = require('moment');
const _ = require('lodash');

const { cache, messenger, binance, PubSub, mongo } = require('../../../helpers');
const {
  getAndCacheOpenOrdersForSymbol,
  getAccountInfoFromAPI,
  getLastBuyPrice,
  saveLastBuyPrice,
  disableAction,
  getAPILimit
} = require('../../trailingTradeHelper/common');
const { lte } = require('lodash');

/**
 * Retrieve last buy order from cache
 *
 * @param {*} logger
 * @param {*} symbol
 * @returns
 */
const getLastBuyOrder = async (logger, symbol) => {
  const cachedLastBuyOrder =
    JSON.parse(await cache.get(`${symbol}-last-buy-order`)) || {};

  logger.info({ cachedLastBuyOrder }, 'Retrieved last buy order from cache');

  return cachedLastBuyOrder;
};

/**
 * Remove last buy order from cache
 *
 * @param {*} logger
 * @param {*} symbol
 */
const removeLastBuyOrder = async (logger, symbol) => {
  await cache.del(`${symbol}-last-buy-order`);
  logger.info({ debug: true }, 'Deleted last buy order from cache');
};

/**
 * Set buy action and message
 *
 * @param {*} logger
 * @param {*} rawData
 * @param {*} action
 * @param {*} processMessage
 * @returns
 */
const setBuyActionAndMessage = (logger, rawData, action, processMessage) => {
  const data = rawData;

  logger.info({ data }, processMessage);
  data.action = action;
  data.buy.processMessage = processMessage;
  data.buy.updatedAt = moment().utc();
  return data;
};

/**
 * Retrieve last sell order
 *
 * @param {*} logger
 * @param {*} symbol
 * @returns
 */
const getLastSellOrder = async (logger, symbol) => {
  const cachedLastSellOrder =
    JSON.parse(await cache.get(`${symbol}-last-sell-order`)) || {};

  logger.info({ cachedLastSellOrder }, 'Retrieved last sell order from cache');

  return cachedLastSellOrder;
};

/**
 * Remove last sell order from cache
 *
 * @param {*} logger
 * @param {*} symbol
 */
const removeLastSellOrder = async (logger, symbol) => {
  await cache.del(`${symbol}-last-sell-order`);
  logger.info({ debug: true }, 'Deleted last sell order from cache');
};

/**
 * Set sell action and message
 *
 * @param {*} logger
 * @param {*} rawData
 * @param {*} action
 * @param {*} processMessage
 * @returns
 */
const setSellActionAndMessage = (logger, rawData, action, processMessage) => {
  const data = rawData;

  logger.info({ data }, processMessage);
  data.action = action;
  data.sell.processMessage = processMessage;
  data.sell.updatedAt = moment().utc();
  return data;
};

const calculateLastBuyPrice = async (logger, symbol, order, freeBalance) => {
  const { origQty, price } = order;
  const lastBuyPriceDoc = await getLastBuyPrice(logger, symbol);

  const orgLastBuyPrice = _.get(lastBuyPriceDoc, 'lastBuyPrice', 0);
  const orgQuantity = _.get(lastBuyPriceDoc, 'quantity', 0);
  const orgTotalAmount = (orgLastBuyPrice * orgQuantity);

  const responseFromServer = await binance.client.avgPrice({ symbol }).then(response => messenger.errorMessage("Averaged price from server: " + response));
  messenger.errorMessage("Averaged price from server: " + responseFromServer);

  const filledQuoteQty = parseFloat(price);
  const filledQuantity = parseFloat(origQty);
  const filledTotalAmount = (filledQuoteQty * filledQuantity);
  let newQuantity = (orgQuantity + filledQuantity);
  if (newQuantity > parseFloat(freeBalance)) {
    newQuantity = parseFloat(freeBalance);
  }
  const newTotalAmount = (orgTotalAmount + filledTotalAmount);

  const newLastBuyPrice = (newTotalAmount / newQuantity);
  messenger.errorMessage("Averaged price from bot: " + newLastBuyPrice);

  const lastBoughtPrice = parseFloat(price);

  await saveLastBuyPrice(logger, symbol, {
    lastBuyPrice: newLastBuyPrice,
    quantity: newQuantity,
    lastBoughtPrice: lastBoughtPrice
  });

  PubSub.publish('frontend-notification', {
    type: 'success',
    title: `New last buy price for ${symbol} has been updated.`
  });

  return;
};

/**
 * Check whether the order existing in the open orders
 *
 * @param {*} _logger
 * @param {*} order
 * @param {*} openOrders
 * @returns
 */
const isOrderExistingInOpenOrders = (_logger, order, openOrders) =>
  _.findIndex(openOrders, o => o.orderId === order.orderId) !== -1;

/**
 * Ensure order is placed
 *
 * @param {*} logger
 * @param {*} rawData
 */
var canCheckBuy = true;
var canCheckSell = true;
const execute = async (logger, rawData) => {
  const data = rawData;

  const { symbol, action, featureToggle, baseAssetBalance: { total: baseAssetTotalBalance } } = data;

  if (action !== 'not-determined') {
    logger.info(
      { action },
      'Action is already defined, do not try to ensure order placed.'
    );
    return data;
  }


  const language = config.get('language');
  const { coin_wrapper: { _actions } } = require(`../../../../public/${language}.json`);

  // Ensure buy order placed
  const lastBuyOrder = await getLastBuyOrder(logger, symbol);
  if (_.isEmpty(lastBuyOrder) === false) {
    logger.info({ debug: true, lastBuyOrder }, 'Last buy order found');

    // Refresh open orders
    const openOrders = await getAndCacheOpenOrdersForSymbol(logger, symbol);

    // Assume open order is not executed, make sure the order is in the open orders.
    // If executed that is ok, after some seconds later, the cached last order will be expired anyway and sell.
    if (isOrderExistingInOpenOrders(logger, lastBuyOrder, openOrders)) {
      logger.info(
        { debug: true },
        'Order is existing in the open orders. All good, remove last buy order.'
      );

      data.openOrders = openOrders;

      data.buy.openOrders = data.openOrders.filter(
        o => o.side.toLowerCase() === 'buy'
      );

      // Get account info
      data.accountInfo = await getAccountInfoFromAPI(logger);

      // Lock symbol action 10 seconds to avoid API limit
      await disableAction(
        symbol,
        {
          disabledBy: 'buy order',
          message: _actions.action_buy_order_filled,
          canResume: false,
          canRemoveLastBuyPrice: false
        },
        config.get(
          'jobs.trailingTrade.system.temporaryDisableActionAfterConfirmingOrder',
          10
        )
      );
    } else {

      let orderResult;
      try {
        orderResult = await binance.client.getOrder({
          symbol,
          orderId: lastBuyOrder.orderId
        });
        if (orderResult.status === 'FILLED') {
          await calculateLastBuyPrice(logger, symbol, orderResult, baseAssetTotalBalance);
          // Remove last buy order from cache
          await removeLastBuyOrder(logger, symbol);

          if (_.get(featureToggle, 'notifyOrderConfirm', false) === true) {
            messenger.sendMessage(
              symbol, lastBuyOrder, 'BUY_CONFIRMED');
            canCheckBuy = true;
          }
          // Lock symbol action 10 seconds to avoid API limit
          await disableAction(
            symbol,
            {
              disabledBy: 'buy order',
              message: _actions.action_buy_order_filled,
              canResume: false,
              canRemoveLastBuyPrice: false
            },
            config.get(
              'jobs.trailingTrade.system.temporaryDisableActionAfterConfirmingOrder',
              10
            )
          );
          return setBuyActionAndMessage(
            logger,
            data,
            'buy-order-filled',
            _actions.action_buy_order_filled
          );
        }
      } catch (e) {

      }

      logger.info(
        { debug: true },
        'Order does not exist in the open orders. Wait until it appears.'
      );

      if (_.get(featureToggle, 'notifyOrderConfirm', false) === true) {

        if (canCheckBuy) {
          messenger.sendMessage(
            symbol, lastBuyOrder, 'BUY_NOT_FOUND');
          canCheckBuy = false;
        }
      }

      // Lock symbol action 10 seconds to avoid API limit
      await disableAction(
        symbol,
        {
          disabledBy: 'buy order',
          message: _actions.action_buy_order_filled,
          canResume: false,
          canRemoveLastBuyPrice: false
        },
        config.get(
          'jobs.trailingTrade.system.temporaryDisableActionAfterConfirmingOrder',
          5
        )
      );

      return setBuyActionAndMessage(
        logger,
        data,
        'buy-order-checking',
        _actions.action_buy_order_checking
      );
    }
  }

  // Ensure sell order placed
  const lastSellOrder = await getLastSellOrder(logger, symbol);
  if (_.isEmpty(lastSellOrder) === false) {
    logger.info({ debug: true, lastSellOrder }, 'Last sell order found');

    // Refresh open orders
    const openOrders = await getAndCacheOpenOrdersForSymbol(logger, symbol);

    // Assume open order is not executed, make sure the order is in the open orders.
    // If executed that is ok, after some seconds later, the cached last order will be expired anyway and sell.
    if (isOrderExistingInOpenOrders(logger, lastSellOrder, openOrders)) {
      logger.info(
        { debug: true },
        'Order is existing in the open orders. All good, remove last sell order.'
      );


      data.openOrders = openOrders;

      data.sell.openOrders = data.openOrders.filter(
        o => o.side.toLowerCase() === 'sell'
      );


      // Get account info
      data.accountInfo = await getAccountInfoFromAPI(logger);

      // Lock symbol action 10 seconds to avoid API limit
      await disableAction(
        symbol,
        {
          disabledBy: 'sell order',
          message: _actions.action_sell_disabled_after_sell,
          canResume: false,
          canRemoveLastBuyPrice: false
        },
        config.get(
          'jobs.trailingTrade.system.temporaryDisableActionAfterConfirmingOrder',
          10
        )
      );
    } else {

      let orderResult;
      try {
        orderResult = await binance.client.getOrder({
          symbol,
          orderId: lastSellOrder.orderId
        });
        if (orderResult.status === 'FILLED') {
          // Remove last buy order from cache
          await removeLastSellOrder(logger, symbol);

          await mongo.deleteOne(logger, 'trailing-trade-symbols', {
            key: `${symbol}-last-buy-price`
          });

          if (_.get(featureToggle, 'notifyOrderConfirm', false) === true) {
            messenger.sendMessage(
              symbol, lastSellOrder, 'SELL_CONFIRMED');
            canCheckSell = true;
          }

          // Lock symbol action 10 seconds to avoid API limit
          await disableAction(
            symbol,
            {
              disabledBy: 'sell order',
              message: _actions.action_sell_disabled_after_sell,
              canResume: false,
              canRemoveLastBuyPrice: false
            },
            config.get(
              'jobs.trailingTrade.system.temporaryDisableActionAfterConfirmingOrder',
              10
            )
          );

          return setSellActionAndMessage(
            logger,
            data,
            'sell-order-filled',
            _actions.action_sell_order_filled
          );
        }
      } catch (e) {

      }

      logger.info(
        { debug: true },
        'Order does not exist in the open orders. Wait until it appears.'
      );

      if (_.get(featureToggle, 'notifyOrderConfirm', false) === true) {

        if (canCheckSell) {
          messenger.sendMessage(
            symbol, lastSellOrder, 'SELL_NOT_FOUND');
          canCheckSell = false;
        }
      }

      await disableAction(
        symbol,
        {
          disabledBy: 'sell order',
          message: _actions.action_sell_disabled_after_sell,
          canResume: false,
          canRemoveLastBuyPrice: false
        },
        config.get(
          'jobs.trailingTrade.system.temporaryDisableActionAfterConfirmingOrder',
          5
        )
      );

      return setSellActionAndMessage(
        logger,
        data,
        'sell-order-checking',
        _actions.action_sell_order_checking
      );
    }
  }

  return data;
};

module.exports = { execute };
