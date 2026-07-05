/* store.js — in-memory data model + encrypted Gist sync.
 *
 * Sign convention (keeps net-worth + credit cards consistent):
 *   income   : account balance += amount
 *   expense  : account balance -= amount
 *   transfer : from -= amount ; to += amount
 * A credit-card account therefore goes NEGATIVE as you spend on it
 * (negative balance = outstanding due). Paying the bill is a transfer
 * bank -> card, which moves the card balance back toward zero.
 *
 * Net worth = sum of ALL account balances = assets − credit-card dues.
 */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';

  const DEFAULT_CATEGORIES = [
    { name: 'Salary', type: 'income' },
    { name: 'Interest', type: 'income' },
    { name: 'Other income', type: 'income' },
    { name: 'Food', type: 'expense' },
    { name: 'Groceries', type: 'expense' },
    { name: 'Rent', type: 'expense' },
    { name: 'Bills', type: 'expense' },
    { name: 'Transport', type: 'expense' },
    { name: 'Shopping', type: 'expense' },
    { name: 'Health', type: 'expense' },
    { name: 'Entertainment', type: 'expense' },
    { name: 'Education', type: 'expense' },
    { name: 'Other', type: 'expense' }
  ];

  function emptyState() {
    return {
      version: 1,
      accounts: [],
      transactions: [],
      categories: DEFAULT_CATEGORIES.map((c) => ({ id: P.uid(), ...c })),
      recurring: [],
      meta: { createdAt: new Date().toISOString() }
    };
  }

  const Store = {
    state: emptyState(),
    key: null,            // CryptoKey (set after unlock)
    dirty: false,
    _saveTimer: null,
    onSync: null,         // callback(status, msg)

    // ---- lifecycle ----
    setKey(key) { this.key = key; },

    fresh() { this.state = emptyState(); this.dirty = true; },

    loadFromObject(obj) {
      if (!obj || typeof obj !== 'object') { this.state = emptyState(); return; }
      this.state = Object.assign(emptyState(), obj);
      // guard arrays
      ['accounts', 'transactions', 'categories', 'recurring'].forEach((k) => {
        if (!Array.isArray(this.state[k])) this.state[k] = [];
      });
      if (!this.state.categories.length) this.state.categories = emptyState().categories;
    },

    // The Gist stores an envelope: { v, salt, data } where `data` is the AES-GCM
    // ciphertext and `salt` is the PBKDF2 salt. Keeping the salt with the data lets
    // any device (or a re-link) derive the same key from the same PIN and decrypt.
    parseEnvelope(raw) {
      if (!raw) return null;
      try {
        const env = JSON.parse(raw);
        if (env && typeof env === 'object') {
          // Real envelope has .data; the seed placeholder ('{}') does not = empty.
          return env.data ? env : null;
        }
      } catch (e) { /* legacy: raw was bare ciphertext, not JSON */ }
      return { salt: null, data: raw };
    },

    // Pull encrypted blob from gist, decrypt into state.
    async pull() {
      if (!P.gist.hasCreds()) return;
      const raw = await P.gist.read();
      const env = this.parseEnvelope(raw);
      if (!env || !env.data) { this.fresh(); return; }
      const obj = await P.crypto.decrypt(this.key, env.data);
      this.loadFromObject(obj);
      this.dirty = false;
    },

    // Encrypt + push state to gist now, wrapping in the salt envelope.
    async push() {
      if (!P.gist.hasCreds() || !this.key) return;
      const data = await P.crypto.encrypt(this.key, this.state);
      const envelope = { v: 1, salt: localStorage.getItem(P.LS.salt), data };
      await P.gist.write(JSON.stringify(envelope));
      this.dirty = false;
    },

    // Mark changed and debounce a background push.
    touch() {
      this.dirty = true;
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.sync(), 1500);
      if (P.ui) P.ui.refresh();
    },

    async sync() {
      if (!P.gist.hasCreds() || !this.key) { if (this.onSync) this.onSync('warn', 'No Gist configured'); return; }
      try {
        if (this.onSync) this.onSync('busy', 'Syncing…');
        await this.push();
        if (this.onSync) this.onSync('ok', 'Synced');
      } catch (e) {
        if (this.onSync) this.onSync('err', e.message || 'Sync failed');
      }
    },

    // ---- accounts ----
    addAccount(a) {
      const acc = {
        id: P.uid(),
        name: a.name,
        type: a.type,                      // cash|bank|upi|card|credit
        openingBalance: Number(a.openingBalance) || 0,
        creditLimit: Number(a.creditLimit) || 0,
        billingDay: a.billingDay ? Number(a.billingDay) : null,  // day of month statement generated
        dueDay: a.dueDay ? Number(a.dueDay) : null               // day of month payment due
      };
      this.state.accounts.push(acc);
      this.touch();
      return acc;
    },
    updateAccount(id, patch) {
      const a = this.state.accounts.find((x) => x.id === id);
      if (a) { Object.assign(a, patch); this.touch(); }
    },
    deleteAccount(id) {
      this.state.accounts = this.state.accounts.filter((x) => x.id !== id);
      // keep orphaned txns but they'll show "unknown account"; simplest & safe
      this.touch();
    },
    account(id) { return this.state.accounts.find((x) => x.id === id); },

    // ---- categories ----
    addCategory(name, type) {
      if (!name.trim()) return;
      this.state.categories.push({ id: P.uid(), name: name.trim(), type: type || 'expense' });
      this.touch();
    },
    deleteCategory(id) {
      this.state.categories = this.state.categories.filter((c) => c.id !== id);
      this.touch();
    },
    categoriesByType(type) { return this.state.categories.filter((c) => c.type === type); },

    // ---- transactions ----
    addTransaction(t) {
      const txn = {
        id: P.uid(),
        type: t.type,                 // income|expense|transfer
        amount: Math.abs(Number(t.amount)) || 0,
        date: t.date || P.fmt.todayISO(),
        category: t.category || (t.type === 'transfer' ? 'Transfer' : ''),
        accountId: t.accountId,
        toAccountId: t.type === 'transfer' ? t.toAccountId : null,
        note: t.note || '',
        recurringId: t.recurringId || null
      };
      this.state.transactions.push(txn);
      this.touch();
      return txn;
    },
    updateTransaction(id, patch) {
      const t = this.state.transactions.find((x) => x.id === id);
      if (t) {
        Object.assign(t, patch);
        if (patch.amount != null) t.amount = Math.abs(Number(patch.amount)) || 0;
        this.touch();
      }
    },
    deleteTransaction(id) {
      this.state.transactions = this.state.transactions.filter((x) => x.id !== id);
      this.touch();
    },

    // ---- recurring ----
    addRecurring(r) {
      const rec = {
        id: P.uid(),
        type: r.type,
        amount: Math.abs(Number(r.amount)) || 0,
        category: r.category || '',
        accountId: r.accountId,
        toAccountId: r.toAccountId || null,
        note: r.note || '',
        frequency: r.frequency || 'monthly',   // monthly|weekly|yearly
        nextDate: r.nextDate || P.fmt.todayISO()
      };
      this.state.recurring.push(rec);
      this.touch();
      return rec;
    },
    deleteRecurring(id) {
      this.state.recurring = this.state.recurring.filter((r) => r.id !== id);
      this.touch();
    },
    advanceDate(iso, freq) {
      const d = new Date(iso + 'T00:00:00');
      if (freq === 'weekly') d.setDate(d.getDate() + 7);
      else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
      else d.setMonth(d.getMonth() + 1); // monthly
      const off = d.getTimezoneOffset();
      return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
    },
    // Generate any recurring entries whose nextDate has arrived. Returns count.
    runRecurring() {
      const today = P.fmt.todayISO();
      let count = 0, guard = 0;
      this.state.recurring.forEach((r) => {
        while (r.nextDate <= today && guard < 500) {
          guard++;
          this.state.transactions.push({
            id: P.uid(), type: r.type, amount: r.amount, date: r.nextDate,
            category: r.category, accountId: r.accountId,
            toAccountId: r.type === 'transfer' ? r.toAccountId : null,
            note: (r.note ? r.note + ' ' : '') + '(recurring)', recurringId: r.id
          });
          r.nextDate = this.advanceDate(r.nextDate, r.frequency);
          count++;
        }
      });
      if (count) this.touch();
      return count;
    },

    // ---- computed ----
    // Balance for one account applying all txns up to (and including) optional dateMax.
    balance(accountId, dateMax) {
      const acc = this.account(accountId);
      let bal = acc ? acc.openingBalance : 0;
      for (const t of this.state.transactions) {
        if (dateMax && t.date > dateMax) continue;
        if (t.type === 'income' && t.accountId === accountId) bal += t.amount;
        else if (t.type === 'expense' && t.accountId === accountId) bal -= t.amount;
        else if (t.type === 'transfer') {
          if (t.accountId === accountId) bal -= t.amount;
          if (t.toAccountId === accountId) bal += t.amount;
        }
      }
      return bal;
    },

    // Outstanding due on a credit card = negative part of its balance.
    ccDue(accountId) {
      const b = this.balance(accountId);
      return b < 0 ? -b : 0;
    },

    // Net worth = sum of all account balances (assets minus CC dues).
    netWorth(dateMax) {
      return this.state.accounts.reduce((s, a) => s + this.balance(a.id, dateMax), 0);
    },
    totalAssets() {
      return this.state.accounts.filter((a) => a.type !== 'credit')
        .reduce((s, a) => s + this.balance(a.id), 0);
    },
    totalDues() {
      return this.state.accounts.filter((a) => a.type === 'credit')
        .reduce((s, a) => s + this.ccDue(a.id), 0);
    },

    // Next due date (ISO) for a credit card, based on dueDay. Null if not set.
    nextDueDate(acc) {
      if (!acc || !acc.dueDay) return null;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let y = today.getFullYear(), m = today.getMonth();
      let d = new Date(y, m, acc.dueDay);
      if (d < today) d = new Date(y, m + 1, acc.dueDay);
      const off = d.getTimezoneOffset();
      return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
    }
  };

  P.store = Store;
})(window.Paisa);
