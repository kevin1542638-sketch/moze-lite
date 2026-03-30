/* ===== sync.js — Google Identity Services + Firebase Auth + Realtime DB ===== */
'use strict';

var MozeSync = (function () {

  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAEbehc911kz5Uvx7D4DQ6pAcqN7lPQgpg',
    authDomain: 'moze-lite.firebaseapp.com',
    databaseURL: 'https://moze-lite-default-rtdb.firebaseio.com',
    projectId: 'moze-lite',
  };

  var GOOGLE_CLIENT_ID = '721616309882-7o6u74re11djphai6j0dgpq42ki3agtr.apps.googleusercontent.com';
  var ADMIN_EMAIL = 'kevin1542638@gmail.com';
  var ERROR_LOG_BUFFER_KEY = 'moze-lite-error-log-buffer-v1';
  var ERROR_LOG_LIMIT = 50;

  var auth = null;
  var db = null;
  var dataRef = null;
  var userIndexRef = null;
  var syncing = false;
  var pushTimer = null;
  var statusEl = null;
  var initialized = false;
  var saveBound = false;
  var gisInitialized = false;
  var gisButtonRendered = false;

  function setStatus(text, color) {
    if (!statusEl) statusEl = document.getElementById('sync-status');
    if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#8e8e96'; }
  }

  function setLoginHint(text) {
    var el = document.getElementById('login-hint');
    if (el) el.textContent = text;
  }

  function truncateText(value, maxLen) {
    if (value === undefined || value === null) return '';
    var text = String(value);
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  function readBufferedErrorLogs() {
    try {
      var raw = localStorage.getItem(ERROR_LOG_BUFFER_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('readBufferedErrorLogs failed', e);
      return [];
    }
  }

  function saveBufferedErrorLogs(entries) {
    try {
      localStorage.setItem(ERROR_LOG_BUFFER_KEY, JSON.stringify(entries.slice(-ERROR_LOG_LIMIT)));
    } catch (e) {
      console.warn('saveBufferedErrorLogs failed', e);
    }
  }

  function removeBufferedErrorLog(id) {
    var entries = readBufferedErrorLogs().filter(function (entry) { return entry.id !== id; });
    saveBufferedErrorLogs(entries);
  }

  function clearBufferedErrorLogs() {
    try {
      localStorage.removeItem(ERROR_LOG_BUFFER_KEY);
    } catch (e) {
      console.warn('clearBufferedErrorLogs failed', e);
    }
  }

  function queueErrorLog(entry) {
    var entries = readBufferedErrorLogs();
    entries.push(entry);
    saveBufferedErrorLogs(entries);
  }

  function sendToTelemetry(entry) {
    if (typeof MozeTelemetry === 'undefined' || typeof MozeTelemetry.captureError !== 'function') return;
    MozeTelemetry.captureError(entry);
  }

  function normalizeErrorLog(input) {
    var now = new Date().toISOString();
    var source = truncateText(input && input.source ? input.source : 'app', 80);
    var message = truncateText(input && input.message ? input.message : 'Unknown error', 500);
    var stack = truncateText(input && input.stack ? input.stack : '', 4000);
    var context = truncateText(input && input.context ? input.context : '', 500);
    var level = truncateText(input && input.level ? input.level : 'error', 20);
    var url = truncateText(input && input.url ? input.url : window.location.href, 300);
    var userAgent = truncateText(window.navigator.userAgent || '', 300);
    return {
      id: (input && input.id) ? input.id : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      source: source,
      message: message,
      stack: stack,
      context: context,
      level: level,
      url: url,
      userAgent: userAgent,
      createdAt: (input && input.createdAt) ? input.createdAt : now,
    };
  }

  function writeErrorLog(entry) {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.reject(new Error('admin-only'));
    }
    return db.ref('adminLogs/' + auth.currentUser.uid + '/' + entry.id).set(entry);
  }

  function flushBufferedErrorLogs() {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.resolve();
    }
    var entries = readBufferedErrorLogs();
    if (!entries.length) return Promise.resolve();

    return entries.reduce(function (chain, entry) {
      return chain.then(function () {
        return writeErrorLog(entry).then(function () {
          removeBufferedErrorLog(entry.id);
        });
      });
    }, Promise.resolve()).catch(function (err) {
      console.warn('flushBufferedErrorLogs failed', err);
    });
  }

  /* ─── Firebase 初始化 ─── */
  function initFirebase() {
    if (initialized) return;
    if (typeof firebase === 'undefined') { setLoginHint('Firebase SDK 載入失敗'); return; }
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    initialized = true;
  }

  /* ─── Google Identity Services 登入 ─── */
  function initGoogleSignIn() {
    if (gisInitialized) {
      renderGoogleButton();
      return;
    }
    if (typeof google === 'undefined' || !google.accounts) {
      setTimeout(initGoogleSignIn, 300);
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: onGoogleCredential,
      auto_select: false,
    });
    gisInitialized = true;
    renderGoogleButton();
  }

  function renderGoogleButton() {
    if (!gisInitialized || gisButtonRendered || typeof google === 'undefined' || !google.accounts) return;
    var btnEl = document.getElementById('google-signin-btn');
    if (!btnEl) return;
    google.accounts.id.renderButton(btnEl, {
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'signin_with',
      locale: 'zh-TW',
      width: 280,
    });
    gisButtonRendered = true;
  }

  function onGoogleCredential(response) {
    initFirebase();
    if (!auth) { setLoginHint('Firebase 初始化失敗'); return; }
    setLoginHint('正在登入…');
    var credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
    auth.signInWithCredential(credential).then(function () {
      setLoginHint('');
    }).catch(function (err) {
      logError({
        source: 'auth',
        message: 'Google sign-in failed',
        stack: err && err.stack ? err.stack : '',
        context: (err && (err.code || err.message)) ? ((err.code || '') + ' ' + (err.message || '')) : '',
      });
      setLoginHint('登入失敗：' + (err.code || '') + ' ' + (err.message || ''));
    });
  }

  /* ─── 登出 ─── */
  function signOut() {
    stopSync();
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
    if (auth) return auth.signOut();
    return Promise.resolve();
  }

  function deleteUserAccount() {
    initFirebase();
    if (!auth || !db || !auth.currentUser) {
      return Promise.reject(new Error('not-signed-in'));
    }

    var user = auth.currentUser;
    var uid = user.uid;

    stopSync();
    setStatus('刪除帳號中…', '#f6c342');

    return Promise.all([
      db.ref('users/' + uid).remove(),
      db.ref('userIndex/' + uid).remove(),
    ]).then(function () {
      return user.delete();
    }).then(function () {
      if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
      }
      setLoginHint('');
      setStatus('帳號已刪除', '#81c784');
    }).catch(function (err) {
      if (err && err.code === 'auth/requires-recent-login') {
        setStatus('需要重新登入', '#e57373');
      } else {
        setStatus('刪除失敗', '#e57373');
      }
      throw err;
    });
  }

  /* ─── Auth 狀態監聽 ─── */
  function onAuthChanged(callback) {
    initFirebase();
    if (!auth) { setLoginHint('Firebase 初始化失敗'); return; }
    auth.onAuthStateChanged(function (user) {
      if (user) { setLoginHint(''); }
      callback(user);
    });
  }

  /* ─── 即時同步 ─── */
  function startSync(uid) {
    if (dataRef) stopSync();
    dataRef = db.ref('users/' + uid + '/moze-data');
    userIndexRef = db.ref('userIndex/' + uid);
    setStatus('連線中…', '#f6c342');

    // Keep a minimal per-user index so the admin panel can count users
    // without needing read access to every user's private accounting data.
    userIndexRef.set(true).catch(function (err) {
      logError({
        source: 'sync',
        message: 'Failed to write user index',
        stack: err && err.stack ? err.stack : '',
        context: err && err.message ? err.message : '',
      });
      console.warn('user index sync failed', err);
    });

    flushBufferedErrorLogs();

    dataRef.once('value').then(function (snapshot) {
      var remote = snapshot.val();
      var localState = MozeData.getState();
      var hasLocalData = typeof MozeData.hasMeaningfulData === 'function' && MozeData.hasMeaningfulData();
      var stateDiffers = !!remote && JSON.stringify(remote) !== JSON.stringify(localState);
      if (remote) {
        if (hasLocalData && stateDiffers) {
          var useLocal = window.confirm(
            '這個 Google 帳戶已經有雲端資料。\n\n按「確定」：用目前本機資料覆蓋雲端。\n按「取消」：用雲端資料覆蓋目前本機資料。'
          );
          if (useLocal) {
            pushNow();
          } else {
            syncing = true;
            MozeData.replaceState(remote);
            syncing = false;
            if (typeof window.mozeRefreshAll === 'function') {
              try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
            }
            setStatus('已同步 ✓', '#81c784');
          }
        } else {
          syncing = true;
          MozeData.replaceState(remote);
          syncing = false;
          if (typeof window.mozeRefreshAll === 'function') {
            try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
          }
          setStatus('已同步 ✓', '#81c784');
        }
      } else {
        pushNow();
      }
      dataRef.on('value', onRemoteChange);
    }).catch(function () {
      setStatus('連線失敗', '#e57373');
      logError({
        source: 'sync',
        message: 'Initial sync connection failed',
      });
      dataRef.on('value', onRemoteChange);
    });

    if (!saveBound) {
      saveBound = true;
      MozeData.onSave(debouncedPush);
    }
  }

  function stopSync() {
    if (dataRef) { try { dataRef.off(); } catch (e) {} dataRef = null; }
    userIndexRef = null;
  }

  function onRemoteChange(snapshot) {
    if (syncing) return;
    var data = snapshot.val();
    if (!data) return;
    syncing = true;
    try { MozeData.replaceState(data); setStatus('已同步 ✓', '#81c784'); }
    catch (e) { console.warn('sync error', e); }
    setTimeout(function () {
      syncing = false;
      if (typeof window.mozeRefreshAll === 'function') {
        try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
      }
    }, 60);
  }

  function pushNow() {
    if (!dataRef || syncing) return;
    var state = MozeData.getState();
    if (!state) return;
    syncing = true;
    setStatus('同步中…', '#f6c342');
    dataRef.set(JSON.parse(JSON.stringify(state))).then(function () {
      syncing = false; setStatus('已同步 ✓', '#81c784');
    }).catch(function () {
      syncing = false; setStatus('同步失敗', '#e57373');
      logError({
        source: 'sync',
        message: 'Push to cloud failed',
      });
    });
  }

  function debouncedPush() {
    if (!dataRef || syncing) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 800);
  }

  function fetchUserCount(callback) {
    if (!db) { callback(0, []); return; }
    db.ref('userIndex').once('value').then(function (snapshot) {
      var data = snapshot.val();
      if (!data) { callback(0, []); return; }
      var uids = Object.keys(data);
      callback(uids.length, uids);
    }).catch(function (err) {
      logError({
        source: 'admin',
        message: 'Fetch user count failed',
        stack: err && err.stack ? err.stack : '',
        context: err && err.message ? err.message : '',
      });
      console.warn('fetchUserCount failed', err);
      callback(0, []);
    });
  }

  function fetchErrorLogs(callback) {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      callback(new Error('forbidden'), []);
      return;
    }
    db.ref('adminLogs/' + auth.currentUser.uid).once('value').then(function (snapshot) {
      var data = snapshot.val() || {};
      var logs = Object.keys(data).map(function (id) {
        return normalizeErrorLog(Object.assign({ id: id }, data[id]));
      }).sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
      callback(null, logs);
    }).catch(function (err) {
      console.warn('fetchErrorLogs failed', err);
      callback(err, []);
    });
  }

  function clearErrorLogs() {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.reject(new Error('forbidden'));
    }
    clearBufferedErrorLogs();
    return db.ref('adminLogs/' + auth.currentUser.uid).remove();
  }

  function logError(input) {
    var entry = normalizeErrorLog(input || {});
    queueErrorLog(entry);
    sendToTelemetry(entry);
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.resolve(entry);
    }
    return writeErrorLog(entry).then(function () {
      removeBufferedErrorLog(entry.id);
      return entry;
    }).catch(function (err) {
      console.warn('writeErrorLog failed', err);
      return entry;
    });
  }

  function isAdmin(user) {
    var email = user && user.email ? String(user.email).toLowerCase() : '';
    return !!email && email === ADMIN_EMAIL;
  }

  function getCurrentUser() {
    return auth ? auth.currentUser : null;
  }

  return {
    initFirebase: initFirebase,
    initGoogleSignIn: initGoogleSignIn,
    signOut: signOut,
    deleteUserAccount: deleteUserAccount,
    onAuthChanged: onAuthChanged,
    startSync: startSync,
    stopSync: stopSync,
    setStatus: setStatus,
    fetchUserCount: fetchUserCount,
    fetchErrorLogs: fetchErrorLogs,
    clearErrorLogs: clearErrorLogs,
    logError: logError,
    getCurrentUser: getCurrentUser,
    isAdmin: isAdmin,
  };
})();
