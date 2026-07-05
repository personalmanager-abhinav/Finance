/* crypto.js — PIN-derived AES-GCM encryption using the Web Crypto API.
 *
 * How it works:
 *  1. A random 16-byte salt is generated once at setup and stored in localStorage.
 *  2. The PIN + salt are run through PBKDF2 (SHA-256, 150k iterations) to derive a
 *     256-bit AES-GCM key. The PIN itself is NEVER stored.
 *  3. Each encryption uses a fresh random 12-byte IV. Output format (base64) is:
 *        [12-byte IV][ciphertext+tag]
 *  4. To validate a PIN on unlock we keep a small "verifier": a known string encrypted
 *     with the derived key. If decrypting it with the entered PIN succeeds, the PIN is
 *     correct; if it throws, the PIN is wrong. Wrong PIN => cannot decrypt real data.
 */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const VERIFIER_PLAINTEXT = 'paisa-ok';

  function b64(bytes) {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(str);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function deriveKey(pin, saltB64) {
    const salt = unb64(saltB64);
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  P.crypto = {
    newSalt() { return b64(crypto.getRandomValues(new Uint8Array(16))); },

    async keyFromPin(pin, saltB64) { return deriveKey(pin, saltB64); },

    // Encrypt a JS object -> base64 string (IV prepended).
    async encrypt(key, obj) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = enc.encode(JSON.stringify(obj));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
      const out = new Uint8Array(iv.length + ct.byteLength);
      out.set(iv, 0);
      out.set(new Uint8Array(ct), iv.length);
      return b64(out);
    },

    // Decrypt base64 string -> JS object. Throws on wrong key / tampering.
    async decrypt(key, b64str) {
      const raw = unb64(b64str);
      const iv = raw.slice(0, 12);
      const ct = raw.slice(12);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return JSON.parse(dec.decode(pt));
    },

    // Build a verifier token so we can check the PIN without the Gist.
    async makeVerifier(key) { return this.encrypt(key, VERIFIER_PLAINTEXT); },
    async checkVerifier(key, verifierB64) {
      try {
        const v = await this.decrypt(key, verifierB64);
        return v === VERIFIER_PLAINTEXT;
      } catch (e) { return false; }
    }
  };
})(window.Paisa);
