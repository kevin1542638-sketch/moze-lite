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

  var auth = null;
  var db = null;
  var dataRef = null;
  var syncing = false;
  var pushTimer = null;
  var statusEl = null;
  var initialized = false;
  var saveBound = false;

  function setStatus(text, color) {
    if (!statusEl) statusEl = document.getElementById('sync-status');
    if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#8e8e96'; }
  }

  function setLoginHint(text) {
    var el = document.getElementById('login-hint');
    if (el) el.textContent = text;
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
    if (typeof google === 'undefined' || !google.accounts) {
      setTimeout(initGoogleSignIn, 300);
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: onGoogleCredential,
      auto_select: true,
    });
    var btnEl = document.getElementById('google-signin-btn');
    if (btnEl) {
      google.accounts.id.renderButton(btnEl, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'signin_with',
        locale: 'zh-TW',
        width: 280,
      });
    }
  }

  function onGoogleCredential(response) {
    initFirebase();
    if (!auth) { setLoginHint('Firebase 初始化失敗'); return; }
    setLoginHint('正在登入…');
    var credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
    auth.signInWithCredential(credential).then(function () {
      setLoginHint('');
    }).catch(function (err) {
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
    setStatus('連線中…', '#f6c342');

    dataRef.once('value').then(function (snapshot) {
      var remote = snapshot.val();
      if (remote) {
        syncing = true;
        MozeData.replaceState(remote);
        syncing = false;
        if (typeof window.mozeRefreshAll === 'function') {
          try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
        }
        setStatus('已同步 ✓', '#81c784');
      } else {
        pushNow();
      }
      dataRef.on('value', onRemoteChange);
    }).catch(function () {
      setStatus('連線失敗', '#e57373');
      dataRef.on('value', onRemoteChange);
    });

    if (!saveBound) {
      saveBound = true;
      MozeData.onSave(debouncedPush);
    }
  }

  function stopSync() {
    if (dataRef) { try { dataRef.off(); } catch (e) {} dataRef = null; }
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
    });
  }

  function debouncedPush() {
    if (!dataRef || syncing) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 800);
  }

  return {
    initFirebase: initFirebase,
    initGoogleSignIn: initGoogleSignIn,
    signOut: signOut,
    onAuthChanged: onAuthChanged,
    startSync: startSync,
    stopSync: stopSync,
    setStatus: setStatus,
  };
})();
