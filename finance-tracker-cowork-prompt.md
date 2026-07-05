# Build Prompt: Personal Finance Tracker (GitHub Pages + Gist Backend)

## Project Goal
Build a personal finance tracker web app. It is a PWA (installable, offline-capable) hosted on **GitHub Pages**. All data is stored in a **single secret GitHub Gist** as encrypted JSON. Single user (me). Mobile and desktop responsive.

## Tech Constraints
- **Plain HTML, CSS, JavaScript.** No React, no frameworks. Vanilla JS only.
- **Multi-file repo structure** (e.g. `index.html`, `css/`, `js/` modules, `manifest.json`, `service-worker.js`, `icons/`).
- You choose the charting library (Chart.js or similar lightweight option). Load via CDN.
- Must deploy cleanly to GitHub Pages (all paths relative, no build step required — or if a build step is used, keep it minimal and documented).
- PWA: valid `manifest.json`, service worker for offline caching, installable on iOS and Android home screen with proper icon and name (I had an earlier problem where a home-screen bookmark showed a generic "L" icon — make sure the manifest icons are correct so this does not happen).

## Data Storage (GitHub Gist)
- **One secret Gist holds all data** in a single JSON file.
- Data is **encrypted client-side before upload** and decrypted after download. Use Web Crypto API (AES-GCM). Never store plaintext financial data in the Gist.
- **GitHub token setup:** user pastes a Personal Access Token (with `gist` scope) into an in-app Settings screen. Store token in browser `localStorage`. Provide clear instructions in-app on how to generate the token and set the Gist ID.
- On first run: let user either create a new Gist or paste an existing Gist ID.
- Handle read/write via GitHub Gist REST API. Include error handling for bad token, network failure, rate limits.

## Security / Lock
- **PIN lock on app open.** User sets a PIN. App is locked until correct PIN entered.
- **The PIN unlocks/derives the decryption key.** Derive the AES key from the PIN (e.g. PBKDF2 with a stored salt). Wrong PIN = cannot decrypt data. Make this flow robust and clearly explained to the user.
- Store only what is necessary in localStorage (token, gist id, salt, theme). Never store the PIN in plaintext.

## Currency
- **INR only.** Format amounts as ₹ with Indian number grouping (e.g. ₹1,20,000).

## Accounts
Support multiple accounts of these types:
- Cash
- Bank
- UPI
- Cards (debit)
- **Credit Card** (special handling — see below)

Allow the user to name accounts. Track a running **balance** per account.

## Credit Card Handling (important)
Credit card spending is "spend now, pay later." Model it properly:
- Credit card purchases create a **liability / outstanding due**, not an immediate cash outflow.
- Track **billing cycle** and **due date** per credit card.
- Show **current dues owed** per card and total.
- **Bill payment is marked later:** when the user pays the CC bill, they record a payment (a transfer from a bank/cash account to the credit card) that reduces the outstanding due. Do not auto-deduct — user marks it paid manually.
- Dashboard should surface upcoming CC due dates and outstanding amounts.

## Transactions
- **Add via manual form only** (no CSV import needed for now).
- Fields per transaction: **Amount, Date, Category, Account.** (Keep the schema extensible so payee/note/tags could be added later, but the form only needs these four.)
- Transaction types: **income, expense, and transfer** (transfers move money between accounts and must not count as income or expense in reports).
- **Recurring transactions:** support recurring entries (e.g. SIM card bill, subscriptions, rent). Let user mark a transaction as recurring with a frequency (monthly, etc.). App should generate or remind about due recurring entries.

## Categories
- **Preset list + custom.** Ship sensible default categories (Food, Rent, Bills, Transport, Shopping, Salary, etc.) AND let the user add/edit/delete their own.

## Dashboard / Views
Include all of these:
- **Month-wise breakdown** (spending/income per month).
- **Category pie chart** (spending by category).
- **Payee-level view** — since payee is not a core field yet, treat this as a breakdown by account and category for now, structured so payee can slot in later. (Confirm approach or implement account/category grouping.)
- **Net worth over time** chart (sum of all account balances across time, factoring in credit card liabilities).
- **Daily / weekly / yearly toggle** on the relevant charts.
- Clear display of per-account balances and total net worth.

## Extras
- **Export / backup button** — download all data as a JSON (and/or CSV) file.
- **Search + filter** transactions (by date range, category, account, amount).

## Theme
- **Light and dark mode with a toggle.** Remember choice in localStorage. Respect system preference on first load.

## Design Direction
- Clean, modern, mobile-first but fully responsive to desktop.
- Fast, uncluttered. Finance apps like Money Manager / Splitwise are reference points for clarity.
- Good touch targets for mobile. Quick access to "add transaction."

## Deliverables
1. Complete multi-file repo, ready to push to GitHub and enable Pages.
2. `README.md` with: setup steps, how to generate the GitHub token, how to create/link the Gist, how to install as PWA on iPhone, and how the PIN/encryption works.
3. Sample/empty data structure documented.
4. All code commented where non-obvious (especially crypto and Gist sync).

## Build Order (suggested)
1. Repo scaffold + PWA manifest + service worker + icons.
2. Settings screen: token, gist id, PIN setup.
3. Crypto layer (PBKDF2 key from PIN, AES-GCM encrypt/decrypt).
4. Gist sync layer (read/write encrypted JSON).
5. Data model: accounts, transactions, categories, recurring, credit-card dues.
6. Transaction form + list + search/filter.
7. Dashboard charts + net worth + toggles.
8. Theme toggle, export/backup.
9. Polish, error handling, README.

Ask me before making major assumptions on anything ambiguous (especially the payee-level view and net-worth-with-credit-card math).
