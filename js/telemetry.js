/* ===== telemetry.js — Optional Sentry bridge ===== */
'use strict';

var MozeTelemetry = (function () {
  var status = {
    state: 'disabled',
    detail: 'Sentry DSN 未設定',
  };
  var initialized = false;

  function getConfig() {
    var root = window.MOZE_APP_CONFIG || {};
    var sentry = root.sentry || {};
    return {
      dsn: sentry.dsn || '',
      environment: sentry.environment || (window.location.hostname === 'localhost' ? 'local' : 'production'),
      release: sentry.release || '',
      tracesSampleRate: typeof sentry.tracesSampleRate === 'number' ? sentry.tracesSampleRate : 0,
    };
  }

  function hasSdk() {
    return typeof window.Sentry !== 'undefined' && window.Sentry && typeof window.Sentry.init === 'function';
  }

  function init() {
    if (initialized) return status;

    var config = getConfig();
    if (!config.dsn) {
      status = { state: 'disabled', detail: 'Sentry DSN 未設定' };
      return status;
    }
    if (!hasSdk()) {
      status = { state: 'sdk-missing', detail: 'Sentry Browser SDK 未載入' };
      return status;
    }

    window.Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release || undefined,
      tracesSampleRate: config.tracesSampleRate,
      sendDefaultPii: false,
    });

    initialized = true;
    status = {
      state: 'enabled',
      detail: 'Sentry 已啟用',
    };
    return status;
  }

  function setUser(user) {
    if (!initialized || !hasSdk() || typeof window.Sentry.setUser !== 'function') return;
    if (!user) {
      window.Sentry.setUser(null);
      return;
    }
    window.Sentry.setUser({
      id: user.uid || undefined,
    });
  }

  function setTag(key, value) {
    if (!initialized || !hasSdk() || typeof window.Sentry.setTag !== 'function') return;
    window.Sentry.setTag(key, value);
  }

  function captureError(payload) {
    init();
    if (!initialized || !hasSdk() || typeof window.Sentry.captureException !== 'function') return;
    var err = new Error(payload && payload.message ? payload.message : 'Unknown error');
    if (payload && payload.stack) err.stack = payload.stack;
    window.Sentry.captureException(err, {
      tags: {
        source: payload && payload.source ? payload.source : 'app',
        level: payload && payload.level ? payload.level : 'error',
      },
      extra: {
        context: payload && payload.context ? payload.context : '',
        url: payload && payload.url ? payload.url : window.location.href,
        userAgent: window.navigator.userAgent || '',
      },
    });
  }

  function captureMessage(message, level) {
    init();
    if (!initialized || !hasSdk() || typeof window.Sentry.captureMessage !== 'function') return;
    window.Sentry.captureMessage(message, level || 'error');
  }

  function getStatus() {
    return init();
  }

  return {
    init: init,
    setUser: setUser,
    setTag: setTag,
    captureError: captureError,
    captureMessage: captureMessage,
    getStatus: getStatus,
  };
})();
