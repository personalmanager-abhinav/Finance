/* gist.js — read/write the single secret Gist over the GitHub REST API.
 * The Gist holds one file, data.json, whose contents are the encrypted (base64) blob.
 * The token (gist scope) and gist id live in localStorage only. */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';
  const API = 'https://api.github.com';
  const FILENAME = 'data.json';

  function token() { return localStorage.getItem(P.LS.token) || ''; }
  function gistId() { return localStorage.getItem(P.LS.gistId) || ''; }

  async function ghFetch(path, opts) {
    opts = opts || {};
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        'Authorization': 'token ' + token(),
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });
    if (res.status === 401) throw new Error('Bad token (401). Check your GitHub token has gist scope.');
    if (res.status === 403) {
      const rem = res.headers.get('x-ratelimit-remaining');
      if (rem === '0') throw new Error('GitHub rate limit reached. Try again in a few minutes.');
      throw new Error('Access forbidden (403).');
    }
    if (res.status === 404) throw new Error('Gist not found (404). Check the Gist ID and token.');
    if (res.status === 422) throw new Error('GitHub rejected the request (422). Token likely lacks gist scope, or is fine-grained without gist access. Use a classic token with the gist scope.');
    if (!res.ok) throw new Error('GitHub error ' + res.status + ': ' + res.statusText);
    return res;
  }

  P.gist = {
    hasCreds() { return !!token() && !!gistId(); },

    // Create a fresh secret gist. GitHub rejects blank file content (422), so seed
    // with a placeholder; the app overwrites it with the encrypted envelope on first save.
    async create(initialContent) {
      const res = await ghFetch('/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: 'Paisa finance data (encrypted). Do not edit manually.',
          public: false,
          files: { [FILENAME]: { content: initialContent || '{}' } }
        })
      });
      const json = await res.json();
      return json.id;
    },

    // Verify a token+id combination by fetching metadata.
    async verify() {
      await ghFetch('/gists/' + gistId(), { method: 'GET' });
      return true;
    },

    // Return the raw (encrypted) string content, or null if empty/new.
    async read() {
      const res = await ghFetch('/gists/' + gistId(), { method: 'GET' });
      const json = await res.json();
      const file = json.files && json.files[FILENAME];
      if (!file) return null;
      // Gist truncates large files; fetch raw_url if so.
      if (file.truncated && file.raw_url) {
        const raw = await fetch(file.raw_url);
        return await raw.text();
      }
      return file.content || null;
    },

    // Overwrite data.json with the encrypted string.
    async write(encryptedStr) {
      await ghFetch('/gists/' + gistId(), {
        method: 'PATCH',
        body: JSON.stringify({ files: { [FILENAME]: { content: encryptedStr } } })
      });
      return true;
    }
  };
})(window.Paisa);
