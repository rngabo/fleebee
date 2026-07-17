const { env } = require("./env");

function buildBrowserConfig() {
  return {
    apiBaseUrl: env.DASHBOARD_API_BASE_URL,
    appName: env.APP_NAME,
    publicAppUrl: env.PUBLIC_APP_URL,
    refreshIntervalMs: env.BOARD_REFRESH_INTERVAL_MS,
    bundleRefreshIntervalMs: env.SMS_BUNDLE_REFRESH_INTERVAL_MS,
    sessionIdleTimeoutMs: env.APP_SESSION_IDLE_TIMEOUT_MS,
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
