/* app.js — bootstrap: service worker, theme, PIN lock, first-run setup,
 * settings, and wiring the store's sync banner. Attaches to window.Paisa.app */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let wired = false;
  let pinBuffer = '';
  let pinMode = 'unlock'; // 'unlock' only (setup uses its own inputs)

  // ---------- service worker ----------
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {});
      });
    }
  }

  // ---------- theme ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1211' : '#ffffff');
  }
  function initTheme() {
    let theme = localStorage.getItem(P.LS.theme);
    if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(theme);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem(P.LS.theme, next);
    applyTheme(next);
    if (P.ui) P.ui.refresh();
  }

  // ---------- screens ----------
  function screen(name) {
    $('screen-lock').hidden = name !== 'lock';
    $('screen-setup').hidden = name !== 'setup';
    $('app').hidden = name !== 'app';
  }

  // ---------- sync banner ----------
  function bannerCb(status, msg) {
    const b = $('sync-banner');
    b.hidden = false;
    b.className = 'sync-banner' + (status === 'err' ? ' err' : status === 'ok' ? ' ok' : '');
    b.textContent = (status === 'busy' ? '⟳ ' : status === 'ok' ? '✓ ' : status === 'err' ? '⚠ ' : '') + msg;
    if (status === 'ok') setTimeout(() => { b.hidden = true; }, 1500);
  }

  // ---------- enter app ----------
  async function enterApp() {
    screen('app');
    if (!wired) { P.ui.wire(); wired = true; }
    P.store.onSync = bannerCb;
    P.store.onConflict = (c) => P.ui.showConflict(c);
    const gen = P.store.runRecurring();
    if (gen > 0) { await P.store.sync(); P.ui.toast(gen + ' recurring entr' + (gen === 1 ? 'y' : 'ies') + ' added'); }
    P.ui.show('dashboard');
    // Show due-soon reminders after the dashboard is up.
    setTimeout(() => P.ui.showReminders(), 350);
  }

  // ---------- PIN keypad ----------
  function buildKeypad() {
    const kp = $('keypad');
    kp.innerHTML = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
    keys.forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = k;
      if (k === 'OK') b.classList.add('wide');
      b.onclick = () => onKey(k);
      kp.appendChild(b);
    });
  }
  function renderDots() {
    const wrap = $('pin-dots'); wrap.innerHTML = '';
    const n = Math.max(pinBuffer.length, 4);
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = 'dot' + (i < pinBuffer.length ? ' filled' : '');
      wrap.appendChild(d);
    }
  }
  function onKey(k) {
    $('lock-error').hidden = true;
    if (k === '⌫') pinBuffer = pinBuffer.slice(0, -1);
    else if (k === 'OK') return submitPin();
    else if (pinBuffer.length < 8) pinBuffer += k;
    renderDots();
    if (pinBuffer.length >= 8) submitPin();
  }
  async function submitPin() {
    if (pinBuffer.length < 4) { showLockError('PIN must be at least 4 digits'); return; }
    const pin = pinBuffer; pinBuffer = ''; renderDots();
    try {
      const salt = localStorage.getItem(P.LS.salt);
      const key = await P.crypto.keyFromPin(pin, salt);
      const ok = await P.crypto.checkVerifier(key, localStorage.getItem(P.LS.verifier));
      if (!ok) { showLockError('Wrong PIN'); return; }
      P.store.setKey(key);
      $('lock-subtitle').textContent = 'Loading your data…';
      try { await P.store.pull(); }
      catch (e) { showLockError('Unlocked, but sync failed: ' + e.message); }
      await enterApp();
    } catch (e) {
      showLockError('Could not unlock: ' + e.message);
    }
  }
  function showLockError(msg) {
    const el = $('lock-error'); el.textContent = msg; el.hidden = false;
  }

  function lock() {
    P.store.key = null;
    pinBuffer = '';
    $('lock-subtitle').textContent = 'Enter your PIN';
    renderDots();
    screen('lock');
  }

  // ---------- first-run setup ----------
  function initSetup() {
    $('setup-creategist').onclick = async () => {
      const token = $('setup-token').value.trim();
      if (!token) { setupError('Paste your GitHub token first'); return; }
      localStorage.setItem(P.LS.token, token);
      $('setup-gist-status').textContent = 'Creating secret Gist…';
      try {
        const id = await P.gist.create('');
        $('setup-gistid').value = id;
        localStorage.setItem(P.LS.gistId, id);
        $('setup-gist-status').textContent = '✓ Created Gist ' + id;
      } catch (e) { $('setup-gist-status').textContent = '⚠ ' + e.message; }
    };

    $('setup-finish').onclick = async () => {
      const token = $('setup-token').value.trim();
      const gistId = $('setup-gistid').value.trim();
      const pin = $('setup-pin').value.trim();
      const pin2 = $('setup-pin2').value.trim();
      if (!token) return setupError('GitHub token required');
      if (!gistId) return setupError('Create or paste a Gist ID');
      if (!/^\d{4,8}$/.test(pin)) return setupError('PIN must be 4–8 digits');
      if (pin !== pin2) return setupError('PINs do not match');

      localStorage.setItem(P.LS.token, token);
      localStorage.setItem(P.LS.gistId, gistId);

      let raw;
      try {
        $('setup-finish').textContent = 'Reading Gist…';
        await P.gist.verify();
        raw = await P.gist.read();
      } catch (e) { $('setup-finish').textContent = 'Finish setup'; return setupError(e.message); }

      const env = P.store.parseEnvelope(raw);
      let salt, key, existingObj = null;

      if (env && env.data) {
        // Existing data: reuse its salt so the same PIN reproduces the same key.
        salt = env.salt || P.crypto.newSalt();
        key = await P.crypto.keyFromPin(pin, salt);
        try { existingObj = await P.crypto.decrypt(key, env.data); }
        catch (e) { $('setup-finish').textContent = 'Finish setup'; return setupError('Wrong PIN for this Gist’s existing data.'); }
      } else {
        // Fresh/empty gist: new salt.
        salt = P.crypto.newSalt();
        key = await P.crypto.keyFromPin(pin, salt);
      }

      const verifier = await P.crypto.makeVerifier(key);
      localStorage.setItem(P.LS.salt, salt);
      localStorage.setItem(P.LS.verifier, verifier);
      localStorage.setItem(P.LS.setupDone, '1');

      P.store.setKey(key);
      P.store.baseRev = env && env.rev ? env.rev : 0;
      if (existingObj) P.store.loadFromObject(existingObj); else P.store.fresh();
      try { await P.store.push(true); } catch (e) { /* offline: will sync later */ }

      await enterApp();
    };
  }
  function setupError(msg) { const el = $('setup-error'); el.textContent = msg; el.hidden = false; }

  // ---------- settings modal ----------
  function openSettings() {
    const body = `
      <label>GitHub token (gist scope)</label>
      <input id="s-token" type="password" value="${(localStorage.getItem(P.LS.token) || '').replace(/"/g, '')}" />
      <label>Gist ID</label>
      <input id="s-gist" type="text" value="${localStorage.getItem(P.LS.gistId) || ''}" />
      <button id="s-savecreds" class="btn ghost block">Save credentials</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
      <label>Change PIN — new PIN (4–8 digits)</label>
      <input id="s-pin1" type="password" inputmode="numeric" placeholder="New PIN" />
      <input id="s-pin2" type="password" inputmode="numeric" placeholder="Confirm new PIN" />
      <button id="s-changepin" class="btn ghost block">Change PIN &amp; re-encrypt</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
      <button id="s-forcesync" class="btn primary block">Force sync now</button>
      <button id="s-reset" class="btn ghost danger block">Reset app (clear this device)</button>
      <div id="s-msg" class="hint"></div>`;
    P.ui && (document.getElementById('modal-title').textContent = 'Settings');
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-root').hidden = false;
    const msg = (m) => { $('s-msg').textContent = m; };

    $('s-savecreds').onclick = () => {
      localStorage.setItem(P.LS.token, $('s-token').value.trim());
      localStorage.setItem(P.LS.gistId, $('s-gist').value.trim());
      msg('Saved. Try Force sync.');
    };
    $('s-changepin').onclick = async () => {
      const p1 = $('s-pin1').value.trim(), p2 = $('s-pin2').value.trim();
      if (!/^\d{4,8}$/.test(p1)) return msg('PIN must be 4–8 digits');
      if (p1 !== p2) return msg('PINs do not match');
      const salt = P.crypto.newSalt();
      const key = await P.crypto.keyFromPin(p1, salt);
      const verifier = await P.crypto.makeVerifier(key);
      localStorage.setItem(P.LS.salt, salt);
      localStorage.setItem(P.LS.verifier, verifier);
      P.store.setKey(key);           // re-encrypt existing state with new key
      try { await P.store.push(); msg('PIN changed and data re-encrypted.'); }
      catch (e) { msg('PIN changed locally, sync failed: ' + e.message); }
    };
    $('s-forcesync').onclick = async () => { msg('Syncing…'); await P.store.sync(); msg('Done.'); };
    $('s-reset').onclick = () => {
      if (confirm('Reset removes token, Gist link and PIN from THIS device. Your encrypted Gist is NOT deleted. Continue?')) {
        [P.LS.token, P.LS.gistId, P.LS.salt, P.LS.verifier, P.LS.setupDone].forEach((k) => localStorage.removeItem(k));
        location.reload();
      }
    };
  }

  // ---------- boot ----------
  function boot() {
    registerSW();
    initTheme();
    buildKeypad();
    renderDots();
    initSetup();

    // lock-screen reset link
    $('lock-reset').onclick = () => {
      if (confirm('Forgot PIN? You can re-link the same Gist with the same PIN to recover, or reset this device. Reset now?')) {
        [P.LS.salt, P.LS.verifier, P.LS.setupDone].forEach((k) => localStorage.removeItem(k));
        location.reload();
      }
    };

    if (localStorage.getItem(P.LS.setupDone) === '1' && localStorage.getItem(P.LS.salt)) {
      screen('lock');
    } else {
      screen('setup');
    }
  }

  P.app = { boot, lock, toggleTheme, openSettings };
  document.addEventListener('DOMContentLoaded', boot);
})(window.Paisa);
