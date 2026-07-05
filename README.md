# Paisa — Personal Finance Tracker (PWA)

A private, offline-capable personal finance tracker. Plain HTML/CSS/vanilla JS, no build step. Hosted on **GitHub Pages**. All your data lives in **one secret GitHub Gist**, encrypted on your device before it ever leaves. Single user, INR, mobile-first.

- Installable PWA (iOS + Android home screen) with a proper ₹ icon.
- Client-side **AES-GCM** encryption; key derived from your **PIN** (PBKDF2).
- Accounts: cash, bank, UPI, debit card, and **credit card** (with dues + due dates).
- Income / expense / transfer transactions, recurring entries, categories.
- Dashboard: net worth, category pie, income-vs-expense trend, net-worth-over-time, account × category breakdown.
- Light / dark theme, JSON + CSV export, search & filter.

---

## 1. Deploy to GitHub Pages

1. Create a new GitHub repo (e.g. `paisa`) and push every file in this folder to it. Keep the structure intact:

   ```
   index.html
   manifest.json
   service-worker.js
   css/styles.css
   js/format.js  js/crypto.js  js/gist.js  js/store.js  js/charts.js  js/ui.js  js/app.js
   icons/…
   ```

2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick `main` and `/ (root)`, save.
3. Wait a minute, then open `https://<your-username>.github.io/paisa/`.

All paths are relative, so it works from a project subpath. No build step.

---

## 2. Create the GitHub token (gist scope)

The app reads/writes your data through the GitHub Gist API, which needs a token.

1. Go to **https://github.com/settings/tokens/new?scopes=gist&description=Paisa** (the app links here too).
2. Give it a name, set an expiry, ensure **only the `gist` scope** is checked.
3. Click **Generate token** and copy it (starts with `ghp_…`).
4. Paste it into Paisa's setup screen. It is stored **only in your browser's localStorage** on that device — never in the Gist, never sent anywhere except api.github.com.

> Classic token with `gist` scope is simplest. A fine-grained token also works if it can create/edit gists.

---

## 3. Link or create the Gist

On first run, in the setup screen:

- **New user:** paste your token, tap **Create new secret Gist**. Paisa makes a private Gist containing one file, `data.json`, and fills in the Gist ID for you.
- **Existing data (new device):** paste your token and the existing **Gist ID**, then enter the **same PIN** you used before. Paisa reads the salt stored in the Gist, re-derives your key, and decrypts your data.

The Gist ID is the hash in the Gist URL: `https://gist.github.com/you/<GIST_ID>`.

---

## 4. PIN & encryption — how it works

- At setup you choose a **4–8 digit PIN**. The PIN is **never stored**.
- A random **salt** is generated. `PBKDF2(PIN, salt, 150k iterations, SHA-256)` derives a 256-bit **AES-GCM** key.
- Your whole dataset is encrypted with that key before upload. Each save uses a fresh random IV.
- The Gist file is an envelope: `{ "salt": "…", "data": "<encrypted base64>" }`. Storing the salt with the data is what lets another device recover everything from **PIN + Gist ID** alone.
- A tiny encrypted "verifier" string is kept locally so the app can tell a **wrong PIN** from a right one instantly (and offline). Wrong PIN = key doesn't match = data cannot be decrypted.

**There is no password recovery.** If you forget the PIN, the data in the Gist cannot be decrypted. Keep a backup (Export JSON) and remember your PIN.

What's stored in localStorage (this device only): token, Gist ID, salt, verifier, theme. Nothing sensitive in plaintext, no PIN.

---

## 5. Install as a PWA

**iPhone (Safari):** open the Pages URL → Share → **Add to Home Screen** → Add. Launches full-screen with the green ₹ icon.

**Android (Chrome):** open the URL → menu → **Install app / Add to Home screen**.

Offline: the app shell is cached by the service worker, so it opens without a network. Syncing data still needs the network (it talks to api.github.com).

> If you update the code, bump `CACHE_VERSION` in `service-worker.js` so devices fetch the new files.

---

## 6. Using it

- **+** (center button) adds a transaction: Expense / Income / Transfer. Fields: amount, date, category, account (+ optional note). Tick **Make recurring** to schedule it (monthly/weekly/yearly).
- **Credit cards:** spending on a card raises its **outstanding due** (it does not reduce cash). When you actually pay the bill, open **Manage → Pay bill** and record a payment (a transfer from a bank/cash account). Nothing auto-deducts.
- **Dashboard** shows net worth (assets − credit-card dues), upcoming CC due dates, per-account balances, and charts with day/week/month/year toggles.
- **Transactions** tab: search + filter by account, category, date range, amount.
- **Manage** tab: accounts, credit-card dues, categories (preset + your own), recurring, and data export.
- Sync happens automatically after edits; the ⟳ button forces it.

---

## 7. Data model

The decrypted `data.json` looks like:

```json
{
  "version": 1,
  "accounts": [
    { "id": "id-…", "name": "HDFC Savings", "type": "bank", "openingBalance": 100000,
      "creditLimit": 0, "billingDay": null, "dueDay": null }
  ],
  "transactions": [
    { "id": "id-…", "type": "expense", "amount": 2000, "date": "2026-07-02",
      "category": "Food", "accountId": "id-…", "toAccountId": null, "note": "", "recurringId": null }
  ],
  "categories": [ { "id": "id-…", "name": "Food", "type": "expense" } ],
  "recurring": [
    { "id": "id-…", "type": "expense", "amount": 300, "category": "Bills",
      "accountId": "id-…", "toAccountId": null, "note": "", "frequency": "monthly", "nextDate": "2026-08-01" }
  ],
  "meta": { "createdAt": "2026-07-06T…Z" }
}
```

Account types: `cash | bank | upi | card | credit`. Transaction types: `income | expense | transfer`.

**Sign convention:** income `+amount` to account, expense `−amount`, transfer `−from / +to`. A credit card therefore goes **negative** as you spend (negative balance = due); paying the bill is a transfer that moves it back toward zero. Net worth is simply the sum of all account balances, which equals **assets − credit-card dues**. Transfers never count as income or expense in reports.

The schema is extensible — a `payee` field can be added later; the "breakdown by account & category" view is the current stand-in for payee-level analysis.

---

## 8. Security notes & limits

- Data is end-to-end encrypted with respect to GitHub: GitHub only ever sees ciphertext.
- Anyone with your **token + Gist ID + PIN** can read your data. Protect the token; revoke it in GitHub settings if leaked.
- A secret Gist is not password-protected, only unlisted — but its contents are encrypted, so that's fine.
- Back up regularly with **Export JSON**.
