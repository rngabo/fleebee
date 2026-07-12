const { env } = require("./env");

function buildBrowserConfig() {
  return {
    apiBaseUrl: env.API_BASE_URL,
    appName: env.APP_NAME,
    refreshIntervalMs: env.BOARD_REFRESH_INTERVAL_MS,
    messageResultTimeoutMs: env.MESSAGE_RESULT_TIMEOUT_MS,
    messageResultPollMs: env.MESSAGE_RESULT_POLL_MS
  };
}

function buildBrowserConfigScript() {
  return `window.FLEEBEE_CONFIG = Object.freeze(${JSON.stringify(buildBrowserConfig())});`;
}

module.exports = {
  buildBrowserConfig,
  buildBrowserConfigScript
};
