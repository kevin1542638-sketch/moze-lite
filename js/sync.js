/* ===== sync.js — Firebase Realtime Database 即時同步 ===== */
'use strict';

const MozeSync = (() => {
  const DB_URL = 'https://moze-lite-default-rtdb.firebaseio.com';
  const DATA_PATH = '/moze-data';

  const DEVICE_ID = localStorage.getItem('moze-device-id') || (() => {
    const id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem('moze-device-id', id);
    return id;
  })();

  let lastWriteTs = 0;
  let pushTimer = null;
  let eventSource = null;
  let statusEl = null;
  let syncing = false;

  function setStatus(text, color) {
    if (!statusEl) statusEl = document.getElementById('sync-status');
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = color || '#8e8e96';
    }
  }

  function pushToFirebase() {
    if (syncing) return;
    const state = MozeData.getState();
    if (!state) return;
    const payload = JSON.parse(JSON.stringify(state));
    payload._sid = DEVICE_ID;
    payload._ts = Date.now();
    lastWriteTs = payload._ts;

    setStatus('同步中…', '#f6c342');

    fetch(DB_URL + DATA_PATH + '.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    .then(function (r) {
      if (r.ok) setStatus('已同步 ✓', '#81c784');
      else setStatus('同步失敗', '#e57373');
    })
    .catch(function () { setStatus('離線', '#e57373'); });
  }

  function debouncedPush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushToFirebase, 800);
  }

  function pullOnce() {
    return fetch(DB_URL + DATA_PATH + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data._ts) {
          applyRemote(data);
        } else if (data === null) {
          pushToFirebase();
        }
      })
      .catch(function () { setStatus('離線', '#e57373'); });
  }

  function applyRemote(data) {
    try {
      if (!data || !data._ts) return;
      if (data._sid === DEVICE_ID) return;
      if (data._ts <= lastWriteTs) return;

      lastWriteTs = data._ts;
      syncing = true;

      var clean = {};
      var skip = { _sid: 1, _ts: 1 };
      Object.keys(data).forEach(function (k) {
        if (!skip[k]) clean[k] = data[k];
      });

      MozeData.replaceState(clean);
      setStatus('已同步 ✓', '#81c784');

      setTimeout(function () {
        syncing = false;
        if (typeof window.mozeRefreshAll === 'function') {
          try { window.mozeRefreshAll(); } catch (e) { console.warn('refresh error', e); }
        }
      }, 50);
    } catch (e) {
      syncing = false;
      console.warn('applyRemote error', e);
    }
  }

  function startSSE() {
    if (eventSource) { try { eventSource.close(); } catch (_) {} }

    try {
      eventSource = new EventSource(DB_URL + DATA_PATH + '.json');

      eventSource.addEventListener('put', function (e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.path === '/' && msg.data && msg.data._ts) {
            applyRemote(msg.data);
          }
        } catch (_) {}
      });

      eventSource.onopen = function () { setStatus('已連線 ✓', '#81c784'); };
      eventSource.onerror = function () { setStatus('重新連線…', '#f6c342'); };
    } catch (_) {
      setStatus('SSE 不支援', '#e57373');
    }
  }

  function init() {
    MozeData.onSave(debouncedPush);
    pullOnce().then(function () { startSSE(); });

    window.addEventListener('online', function () {
      debouncedPush();
      startSSE();
    });
    window.addEventListener('offline', function () { setStatus('離線', '#e57373'); });
  }

  return { init: init };
})();
