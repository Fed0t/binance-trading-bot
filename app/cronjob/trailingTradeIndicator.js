const moment = require('moment');
const config = require('config');

const {
  lockSymbol,
  isSymbolLocked,
  unlockSymbol,
  getAPILimit,
  isExceedAPILimit
} = require('./trailingTradeHelper/common');

const {
  getGlobalConfiguration,
  getNextSymbol,
  getSymbolConfiguration,
  getOverrideAction,
  getAccountInfo,
  getIndicators,
  getOpenOrders,
  executeDustTransfer,
  saveDataToCache
} = require('./trailingTradeIndicator/steps');
const { messenger } = require('../helpers');
const { updateTelegramBotTrailingTradeIndicatorData } = require('../helpers/telegram');

const execute = async logger => {
  // Retrieve feature toggles
  const featureToggle = config.get('featureToggle');

  // Define skeleton of data structure
  let data = {
    action: 'not-determined',
    featureToggle,
    globalConfiguration: {},
    symbol: null,
    symbolConfiguration: {},
    accountInfo: {},
    indicators: {},
    openOrders: [],
    overrideParams: {},
    apiLimit: { start: getAPILimit(logger), end: null }
  };

  if (isExceedAPILimit(logger)) {
    return data;
  }

  try {
    data = await getGlobalConfiguration(logger, data);
    data = await getNextSymbol(logger, data);

    const { symbol } = data;
    logger.info(
      { debug: true, symbol },
      '▶ TrailingTradeIndicator: Start process...'
    );

    // Check if the symbol is locked, if it is locked, it means the symbol is still trading.
    if ((await isSymbolLocked(logger, symbol)) === true) {
      logger.info(
        { debug: true, symbol },
        '⏯ TrailingTradeIndicator: Skip process as the symbol is currently locked.'
      );
      return;
    }
    // Lock symbol for processing
    await lockSymbol(logger, symbol);

    // eslint-disable-next-line no-restricted-syntax
    for (const { stepName, stepFunc } of [
      {
        stepName: 'get-symbol-configuration',
        stepFunc: getSymbolConfiguration
      },
      {
        stepName: 'get-override-action',
        stepFunc: getOverrideAction
      },
      {
        stepName: 'execute-dust-transfer',
        stepFunc: executeDustTransfer
      },
      {
        stepName: 'get-account-info',
        stepFunc: getAccountInfo
      },
      {
        stepName: 'get-indicators',
        stepFunc: getIndicators
      },
      {
        // Note that open orders for all symbols cannot exceed 40 request per minute.
        // Hence, this must be executed every 2 seconds.
        // After placing buy/sell orders, the bot will retrieve symbol open orders which can request every second.
        stepName: 'get-open-orders',
        stepFunc: getOpenOrders
      },
      {
        stepName: 'save-data-to-cache',
        stepFunc: saveDataToCache
      }
    ]) {
      const stepLogger = logger.child({ stepName, symbol: data.symbol });

      stepLogger.info({ data }, `Start step - ${stepName}`);

      // eslint-disable-next-line no-await-in-loop
      data = await stepFunc(stepLogger, data);
      stepLogger.info({ data }, `Finish step - ${stepName}`);
    }

    // Unlock symbol for processing
    await unlockSymbol(logger, symbol);

    data.apiLimit.end = getAPILimit(logger);

    logger.info(
      { debug: true, symbol },
      '⏹ TrailingTradeIndicator: Finish process (Debug)...'
    );

    await updateTelegramBotTrailingTradeIndicatorData(data);

    logger.info({ symbol, data }, 'TrailingTradeIndicator: Finish process...');
  } catch (err) {
    logger.error(
      { symbol: data.symbol, err, debug: true },
      `⚠ Execution failed.`
    );
    if (
      err.code === -1001 ||
      err.code === -1021 || // Timestamp for this request is outside of the recvWindow
      err.code === 'ECONNRESET' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ETIMEDOUT' ||
      err.message.includes('redlock') // For the redlock fail
    ) {
      // Let's silent for internal server error or assumed temporary errors
    } else {

      messenger.errorMessage(
        `Execution failed (${moment().format('HH:mm:ss.SSS')})\n` +
        `Job: Trailing Trade Indicator\n` +
        `Code: ${err.code}\n` +
        `Error message: ${err.message}\n` +
        `There's something *wrong*.\n` +
        `You may want to reset me. You can try this *after disabling me in docker*:\n` +
        `wsl --shutdown\n` +
        `Now *restart wsl through windows notification* (if you're a windows user).\n` +
        `Or you can *try this* to *sync docker clock with your machine*:\n` +
        `docker run -it --rm --privileged --pid=host debian nsenter -t 1 -m -u -n -i date -u $(date -u +%m%d%H%M%Y)\n` +
        `Then you just need to *restart* me.\n` +
        `- Current API Usage: ${getAPILimit(logger)}`
      );
    }
  }
};

module.exports = { execute };
