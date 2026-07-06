/* ui.js — rendering + interaction for the main app. Attaches to window.Paisa.ui */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';
  const S = () => P.store;
  const esc = P.esc;
  const $ = (id) => document.getElementById(id);
  let currentView = 'dashboard';

  const TYPE_ICON = { cash: '💵', bank: '🏦', upi: '📱', card: '💳', credit: '🧾' };
  const TYPE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', card: 'Debit card', credit: 'Credit card' };

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- modal ----------
  function openModal(title, bodyHTML, onMount) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHTML;
    $('modal-root').hidden = false;
    if (onMount) onMount($('modal-body'));
  }
  function closeModal() { $('modal-root').hidden = true; $('modal-body').innerHTML = ''; }

  // ---------- navigation ----------
  function show(view) {
    currentView = view;
    ['dashboard', 'transactions', 'insights', 'manage'].forEach((v) => {
      $('view-' + v).hidden = v !== view;
    });
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === view));
    refresh();
  }

  function refresh() {
    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'transactions') renderTransactions();
    else if (currentView === 'insights') renderInsights();
    else if (currentView === 'manage') renderManage();
  }

  // ---------- dashboard ----------
  function renderDashboard() {
    const st = S();
    $('nw-value').textContent = P.fmt.money(st.netWorth());
    $('nw-sub').textContent = `Assets ${P.fmt.money(st.totalAssets())}  ·  CC dues ${P.fmt.money(st.totalDues())}`;

    // credit card alerts
    const ccWrap = $('cc-alerts'); ccWrap.innerHTML = '';
    st.state.accounts.filter((a) => a.type === 'credit').forEach((a) => {
      const due = st.ccDue(a.id);
      if (due <= 0 && !a.dueDay) return;
      const dueDate = st.nextDueDate(a);
      let soon = false, when = '';
      if (dueDate) {
        const days = Math.round((new Date(dueDate) - new Date(P.fmt.todayISO())) / 86400000);
        soon = days <= 5;
        when = `Due ${P.fmt.date(dueDate)}${days >= 0 ? ` (${days}d)` : ''}`;
      }
      const div = document.createElement('div');
      div.className = 'cc-alert' + (soon ? ' soon' : '');
      div.innerHTML = `<div><b>${esc(a.name)}</b><small>${when || 'No due date set'}</small></div>
        <div style="text-align:right"><b>${P.fmt.money(due)}</b><small>outstanding</small></div>`;
      ccWrap.appendChild(div);
    });

    renderTemplateRow();
    renderGoalsBlock();

    // account cards
    const wrap = $('account-cards'); wrap.innerHTML = '';
    if (!st.state.accounts.length) {
      wrap.innerHTML = '<p class="hint">No accounts yet. Add one to get started.</p>';
    }
    st.state.accounts.forEach((a) => {
      const isCredit = a.type === 'credit';
      const bal = st.balance(a.id);
      const display = isCredit ? st.ccDue(a.id) : bal;
      const card = document.createElement('div');
      card.className = 'acct-card' + (isCredit ? ' cc' : '');
      card.innerHTML = `<div class="a-type">${TYPE_ICON[a.type] || ''} ${TYPE_LABEL[a.type] || a.type}</div>
        <div class="a-name">${esc(a.name)}</div>
        <div class="a-bal">${isCredit ? 'Due ' : ''}${P.fmt.money(display)}</div>`;
      card.onclick = () => openAccountModal(a);
      wrap.appendChild(card);
    });

    // charts
    P.charts.category('chart-category', $('pie-range').value);
    P.charts.trend('chart-trend', $('bar-granularity').value);
    P.charts.networth('chart-networth');
    P.charts.breakdown('breakdown-table', $('pie-range').value);
  }

  // ---------- quick-add templates (dashboard chip row) ----------
  function renderTemplateRow() {
    const st = S();
    const row = $('template-row');
    const chips = st.state.templates.map((t) =>
      `<button class="tpl-chip" data-tpl="${t.id}" type="button">${esc(t.label)}
        <span class="tpl-amt">${P.fmt.money(t.amount)}</span></button>`).join('');
    row.innerHTML = chips + `<button class="tpl-chip add" id="tpl-add-inline" type="button">+ Template</button>`;
  }

  // ---------- goals (dashboard block) ----------
  function goalCardHTML(g) {
    const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
    let meta = `${pct}%`;
    if (g.deadline) {
      const months = Math.max(0, (new Date(g.deadline) - new Date(P.fmt.todayISO())) / 2629800000);
      const remaining = Math.max(0, g.target - g.current);
      if (remaining > 0 && months > 0) meta += ` · need ${P.fmt.money(remaining / months)}/mo by ${P.fmt.date(g.deadline)}`;
      else if (remaining > 0) meta += ` · due ${P.fmt.date(g.deadline)}`;
    }
    return `<div class="goal" data-goal="${g.id}">
      <div class="goal-head"><span class="goal-name">${esc(g.name)}</span>
        <span class="goal-nums">${P.fmt.money(g.current)} / ${P.fmt.money(g.target)}</span></div>
      <div class="goal-track"><div class="goal-fill" style="width:${pct}%"></div></div>
      <div class="goal-meta"><span>${meta}</span></div>
      <div class="goal-actions">
        <button class="btn ghost" data-goal-add="${g.id}" type="button">+ Contribute</button>
        <button class="btn ghost" data-goal-edit="${g.id}" type="button">Edit</button>
      </div></div>`;
  }
  function renderGoalsBlock() {
    const st = S();
    const el = $('goals-block');
    if (!st.state.goals.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h3 class="section-title">Savings goals</h3>' + st.state.goals.map(goalCardHTML).join('');
  }

  // ---------- insights view ----------
  function renderInsights() {
    const k = P.insights.kpis();
    const kpi = (label, value, sub, pos) =>
      `<div class="kpi"><div class="k-label">${label}</div>
        <div class="k-value${pos ? ' pos' : ''}">${value}</div><div class="k-sub">${sub || ''}</div></div>`;
    const rate = k.savingsRate == null ? '—' : Math.round(k.savingsRate * 100) + '%';
    const runway = k.runway == null ? '—' : k.runway.toFixed(1) + ' mo';
    $('ins-kpis').innerHTML =
      kpi('Income', P.fmt.money(k.income), k.monthLabel) +
      kpi('Expense', P.fmt.money(k.expense), k.monthLabel) +
      kpi('Net', P.fmt.money(k.net), k.net >= 0 ? 'saved' : 'overspent', k.net >= 0) +
      kpi('Savings rate', rate, 'of income', k.savingsRate != null && k.savingsRate >= 0) +
      kpi('Runway', runway, 'at recent pace') +
      kpi('Avg spend', P.fmt.money(k.avgMonthlyExpense), '3-mo/month');

    $('ins-notes').innerHTML = P.insights.notes().map((n) => `<div class="insight-item">${esc(n)}</div>`).join('');

    P.charts.heatmap('ins-heatmap');
    P.charts.topPayees('ins-payees', $('payee-range').value);
    P.charts.sankey('ins-sankey');
    P.charts.momCompare('ins-mom');
  }

  // ---------- transactions ----------
  function getFilters() {
    return {
      q: $('f-search').value.trim().toLowerCase(),
      acc: $('f-account').value,
      cat: $('f-category').value,
      from: $('f-from').value,
      to: $('f-to').value,
      min: $('f-min').value ? Number($('f-min').value) : null,
      max: $('f-max').value ? Number($('f-max').value) : null
    };
  }
  function applyFilters(list, f) {
    return list.filter((t) => {
      if (f.acc && t.accountId !== f.acc && t.toAccountId !== f.acc) return false;
      if (f.cat && t.category !== f.cat) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.min != null && t.amount < f.min) return false;
      if (f.max != null && t.amount > f.max) return false;
      if (f.q) {
        const hay = (t.category + ' ' + (t.note || '')).toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
  }
  function populateFilterSelects() {
    const st = S();
    const accSel = $('f-account'), catSel = $('f-category');
    const accVal = accSel.value, catVal = catSel.value;
    accSel.innerHTML = '<option value="">All accounts</option>' +
      st.state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    const cats = [...new Set(st.state.categories.map((c) => c.name))];
    catSel.innerHTML = '<option value="">All categories</option>' +
      cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    accSel.value = accVal; catSel.value = catVal;
  }
  function renderTransactions() {
    populateFilterSelects();
    const st = S();
    const f = getFilters();
    const list = applyFilters(st.state.transactions.slice(), f)
      .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0) || (b.id < a.id ? -1 : 1));

    let income = 0, expense = 0;
    list.forEach((t) => { if (t.type === 'income') income += t.amount; else if (t.type === 'expense') expense += t.amount; });
    $('txn-summary').innerHTML =
      `<span>${list.length} txns</span><span>Income <b>${P.fmt.money(income)}</b></span>` +
      `<span>Expense <b>${P.fmt.money(expense)}</b></span><span>Net <b>${P.fmt.money(income - expense)}</b></span>`;

    const wrap = $('txn-list'); wrap.innerHTML = '';
    if (!list.length) { wrap.innerHTML = '<p class="hint">No transactions match.</p>'; return; }
    let lastDay = null;
    list.forEach((t) => {
      if (t.date !== lastDay) {
        lastDay = t.date;
        const lbl = document.createElement('div'); lbl.className = 'txn-day-label';
        lbl.textContent = P.fmt.dayLabel(t.date); wrap.appendChild(lbl);
      }
      const acc = st.account(t.accountId);
      const toAcc = t.toAccountId ? st.account(t.toAccountId) : null;
      let meta, icon, sign;
      if (t.type === 'transfer') {
        meta = `${acc ? esc(acc.name) : '?'} → ${toAcc ? esc(toAcc.name) : '?'}`;
        icon = '↔'; sign = '';
      } else {
        meta = acc ? esc(acc.name) : 'Unknown account';
        icon = t.type === 'income' ? '↓' : '↑';
        sign = t.type === 'income' ? '+' : '−';
      }
      if (t.note) meta += ' · ' + esc(t.note);
      const row = document.createElement('div');
      row.className = 'txn';
      row.innerHTML = `<div class="t-icon">${icon}</div>
        <div class="t-main"><div class="t-cat">${esc(t.category || (t.type === 'transfer' ? 'Transfer' : 'Uncategorised'))}</div>
        <div class="t-meta">${meta}</div></div>
        <div class="t-amt ${t.type}">${sign}${P.fmt.money(t.amount)}</div>`;
      row.onclick = () => openTxnModal(t);
      wrap.appendChild(row);
    });
  }

  // ---------- manage ----------
  function renderManage() {
    const st = S();
    // accounts
    $('manage-accounts').innerHTML = st.state.accounts.map((a) => {
      const bal = a.type === 'credit' ? st.ccDue(a.id) : st.balance(a.id);
      return `<div class="row-item"><div class="ri-main"><b>${esc(a.name)}</b>
        <div class="ri-sub">${TYPE_LABEL[a.type] || a.type} · ${a.type === 'credit' ? 'Due ' : ''}${P.fmt.money(bal)}</div></div>
        <button class="btn ghost" data-edit-acct="${a.id}">Edit</button></div>`;
    }).join('') || '<p class="hint">No accounts.</p>';

    // credit cards
    const ccs = st.state.accounts.filter((a) => a.type === 'credit');
    $('manage-cc').innerHTML = ccs.map((a) => {
      const due = st.ccDue(a.id);
      const dd = st.nextDueDate(a);
      return `<div class="row-item"><div class="ri-main"><b>${esc(a.name)}</b>
        <div class="ri-sub">Due ${P.fmt.money(due)}${dd ? ' · pay by ' + P.fmt.date(dd) : ''}${a.creditLimit ? ' · limit ' + P.fmt.money(a.creditLimit) : ''}</div></div>
        <button class="btn primary" data-pay-cc="${a.id}">Pay bill</button></div>`;
    }).join('') || '<p class="hint">No credit cards.</p>';

    // categories
    $('manage-categories').innerHTML = ['income', 'expense'].map((type) => {
      const chips = st.categoriesByType(type).map((c) =>
        `<span class="chip">${esc(c.name)}<button data-del-cat="${c.id}" title="Delete">✕</button></span>`).join('');
      return `<div class="ri-sub" style="margin-top:6px">${type === 'income' ? 'Income' : 'Expense'}</div><div>${chips || '<span class="hint">none</span>'}</div>`;
    }).join('');

    // recurring
    $('manage-recurring').innerHTML = st.state.recurring.map((r) => {
      const acc = st.account(r.accountId);
      return `<div class="row-item"><div class="ri-main"><b>${esc(r.category || r.type)} · ${P.fmt.money(r.amount)}</b>
        <div class="ri-sub">${r.frequency} · ${acc ? esc(acc.name) : '?'} · next ${P.fmt.date(r.nextDate)}</div></div>
        <button class="btn ghost danger" data-del-rec="${r.id}">Delete</button></div>`;
    }).join('') || '<p class="hint">No recurring entries. Add one from the + button (toggle Recurring).</p>';
  }

  // ---------- transaction modal ----------
  function accountOptions(selected, filterFn) {
    return S().state.accounts.filter(filterFn || (() => true))
      .map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)} (${TYPE_LABEL[a.type]})</option>`).join('');
  }
  function categoryOptions(type, selected) {
    return S().categoriesByType(type)
      .map((c) => `<option value="${esc(c.name)}" ${c.name === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }
  // Distinct past payees for the autocomplete datalist.
  function payeeDatalist() {
    const seen = new Set();
    S().state.transactions.forEach((t) => { if (t.payee) seen.add(t.payee); });
    return Array.from(seen).map((p) => `<option value="${esc(p)}">`).join('');
  }

  function openTxnModal(existing) {
    const st = S();
    if (!st.state.accounts.length) { toast('Add an account first'); openAccountModal(); return; }
    const t = existing || { type: 'expense', date: P.fmt.todayISO(), amount: '', category: '', accountId: st.state.accounts[0].id, toAccountId: null, payee: '', note: '' };
    const body = `
      <div class="seg type">
        <button data-type="expense" class="${t.type === 'expense' ? 'active' : ''}">Expense</button>
        <button data-type="income" class="${t.type === 'income' ? 'active' : ''}">Income</button>
        <button data-type="transfer" class="${t.type === 'transfer' ? 'active' : ''}">Transfer</button>
      </div>
      <label>Amount (₹)</label>
      <input id="m-amount" type="number" inputmode="decimal" step="0.01" placeholder="0" value="${t.amount || ''}" />
      <label>Date</label>
      <input id="m-date" type="date" value="${t.date}" />
      <div id="m-cat-wrap"><label>Category</label>
        <select id="m-category">${categoryOptions(t.type === 'income' ? 'income' : 'expense', t.category)}</select></div>
      <label id="m-acc-label">Account</label>
      <select id="m-account">${accountOptions(t.accountId)}</select>
      <div id="m-to-wrap" hidden><label>To account</label>
        <select id="m-toaccount">${accountOptions(t.toAccountId)}</select></div>
      <div id="m-payee-wrap"><label>Payee (optional)</label>
        <input id="m-payee" type="text" list="payee-list" placeholder="e.g. Blinkit, Zomato" value="${esc(t.payee || '')}" />
        <datalist id="payee-list">${payeeDatalist()}</datalist></div>
      <label>Note (optional)</label>
      <input id="m-note" type="text" placeholder="e.g. Jio recharge" value="${esc(t.note || '')}" />
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
        <input id="m-recurring" type="checkbox" style="width:auto;margin:0" ${existing ? 'disabled' : ''}/> Make recurring</label>
      <div id="m-rec-wrap" hidden>
        <label>Frequency</label>
        <select id="m-frequency"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option></select>
      </div>
      <button id="m-save" class="btn primary block">${existing ? 'Save changes' : 'Add transaction'}</button>
      ${existing ? '<button id="m-delete" class="btn ghost danger block">Delete</button>' : ''}`;

    openModal(existing ? 'Edit transaction' : 'New transaction', body, (root) => {
      let type = t.type;
      const applyType = () => {
        root.querySelectorAll('.seg.type button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
        const isTransfer = type === 'transfer';
        $('m-cat-wrap').hidden = isTransfer;
        $('m-to-wrap').hidden = !isTransfer;
        $('m-payee-wrap').hidden = isTransfer;
        $('m-acc-label').textContent = isTransfer ? 'From account' : 'Account';
        if (!isTransfer) $('m-category').innerHTML = categoryOptions(type === 'income' ? 'income' : 'expense', t.category);
      };
      applyType();
      root.querySelectorAll('.seg.type button').forEach((b) => b.onclick = () => { type = b.dataset.type; applyType(); });
      $('m-recurring').onchange = (e) => { $('m-rec-wrap').hidden = !e.target.checked; };

      $('m-save').onclick = () => {
        const amount = Number($('m-amount').value);
        if (!amount || amount <= 0) { toast('Enter a valid amount'); return; }
        const accountId = $('m-account').value;
        const data = {
          type, amount, date: $('m-date').value || P.fmt.todayISO(),
          category: type === 'transfer' ? 'Transfer' : $('m-category').value,
          accountId, toAccountId: type === 'transfer' ? $('m-toaccount').value : null,
          payee: type === 'transfer' ? '' : $('m-payee').value.trim(),
          note: $('m-note').value.trim()
        };
        if (type === 'transfer' && data.accountId === data.toAccountId) { toast('Pick two different accounts'); return; }
        if (existing) { st.updateTransaction(existing.id, data); toast('Updated'); }
        else {
          st.addTransaction(data);
          if ($('m-recurring').checked) {
            st.addRecurring({ ...data, frequency: $('m-frequency').value, nextDate: st.advanceDate(data.date, $('m-frequency').value) });
          }
          toast('Added');
        }
        closeModal(); refresh();
      };
      if (existing) $('m-delete').onclick = () => {
        st.deleteTransaction(existing.id); toast('Deleted'); closeModal(); refresh();
      };
    });
  }

  // ---------- account modal ----------
  function openAccountModal(existing) {
    const a = existing || { name: '', type: 'bank', openingBalance: '', creditLimit: '', billingDay: '', dueDay: '' };
    const typeOpts = Object.keys(TYPE_LABEL).map((k) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${TYPE_LABEL[k]}</option>`).join('');
    const body = `
      <label>Name</label>
      <input id="a-name" type="text" placeholder="e.g. HDFC Savings" value="${esc(a.name)}" />
      <label>Type</label>
      <select id="a-type">${typeOpts}</select>
      <label id="a-open-label">Opening balance (₹)</label>
      <input id="a-open" type="number" step="0.01" placeholder="0" value="${a.openingBalance || ''}" />
      <div id="a-credit" hidden>
        <label>Credit limit (₹, optional)</label>
        <input id="a-limit" type="number" step="0.01" placeholder="0" value="${a.creditLimit || ''}" />
        <label>Statement day of month (optional)</label>
        <input id="a-billing" type="number" min="1" max="31" placeholder="e.g. 5" value="${a.billingDay || ''}" />
        <label>Payment due day of month (optional)</label>
        <input id="a-due" type="number" min="1" max="31" placeholder="e.g. 22" value="${a.dueDay || ''}" />
      </div>
      <button id="a-save" class="btn primary block">${existing ? 'Save' : 'Add account'}</button>
      ${existing ? '<button id="a-delete" class="btn ghost danger block">Delete account</button>' : ''}`;

    openModal(existing ? 'Edit account' : 'New account', body, () => {
      const syncCredit = () => {
        const isC = $('a-type').value === 'credit';
        $('a-credit').hidden = !isC;
        $('a-open-label').textContent = isC ? 'Opening due (₹, usually 0)' : 'Opening balance (₹)';
      };
      syncCredit();
      $('a-type').onchange = syncCredit;
      $('a-save').onclick = () => {
        const name = $('a-name').value.trim();
        if (!name) { toast('Name required'); return; }
        const type = $('a-type').value;
        // For a credit card, opening "due" is stored as a negative opening balance.
        let opening = Number($('a-open').value) || 0;
        if (type === 'credit' && opening > 0) opening = -opening;
        const data = {
          name, type, openingBalance: opening,
          creditLimit: Number($('a-limit') && $('a-limit').value) || 0,
          billingDay: $('a-billing') && $('a-billing').value ? Number($('a-billing').value) : null,
          dueDay: $('a-due') && $('a-due').value ? Number($('a-due').value) : null
        };
        if (existing) { S().updateAccount(existing.id, data); toast('Saved'); }
        else { S().addAccount(data); toast('Account added'); }
        closeModal(); refresh();
      };
      if (existing) $('a-delete').onclick = () => {
        if (confirm('Delete this account? Transactions stay but will show as unknown account.')) {
          S().deleteAccount(existing.id); toast('Deleted'); closeModal(); refresh();
        }
      };
    });
  }

  // ---------- pay credit card bill ----------
  function openPayCCModal(ccId) {
    const st = S();
    const cc = st.account(ccId);
    const due = st.ccDue(ccId);
    const payFrom = st.state.accounts.filter((a) => a.type !== 'credit');
    if (!payFrom.length) { toast('Add a bank/cash account first'); return; }
    const body = `
      <p class="hint">Record a payment toward <b>${esc(cc.name)}</b>. Current due ${P.fmt.money(due)}.
      This creates a transfer that reduces the outstanding balance.</p>
      <label>Pay from</label>
      <select id="p-from">${payFrom.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
      <label>Amount (₹)</label>
      <input id="p-amount" type="number" step="0.01" value="${due || ''}" />
      <label>Date</label>
      <input id="p-date" type="date" value="${P.fmt.todayISO()}" />
      <button id="p-save" class="btn primary block">Record payment</button>`;
    openModal('Pay credit card bill', body, () => {
      $('p-save').onclick = () => {
        const amount = Number($('p-amount').value);
        if (!amount || amount <= 0) { toast('Enter amount'); return; }
        st.addTransaction({ type: 'transfer', amount, date: $('p-date').value, category: 'CC payment',
          accountId: $('p-from').value, toAccountId: ccId, note: 'Credit card bill payment' });
        toast('Payment recorded'); closeModal(); refresh();
      };
    });
  }

  // ---------- export ----------
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJSON() {
    download('paisa-backup-' + P.fmt.todayISO() + '.json', JSON.stringify(S().state, null, 2), 'application/json');
    toast('JSON exported');
  }
  function exportCSV() {
    const st = S();
    const acctName = (id) => { const a = st.account(id); return a ? a.name : ''; };
    const rows = [['Date', 'Type', 'Category', 'Account', 'To Account', 'Amount', 'Note']];
    st.state.transactions.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach((t) => {
      rows.push([t.date, t.type, t.category || '', acctName(t.accountId), t.toAccountId ? acctName(t.toAccountId) : '',
        t.amount, (t.note || '').replace(/"/g, '""')]);
    });
    const csv = rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? `"${c}"` : c).join(',')).join('\n');
    download('paisa-transactions-' + P.fmt.todayISO() + '.csv', csv, 'text/csv');
    toast('CSV exported');
  }

  // ---------- wire static controls (called once) ----------
  function wire() {
    // nav
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) => b.onclick = () => show(b.dataset.view));
    $('fab-add').onclick = () => openTxnModal();
    $('btn-add-account').onclick = () => openAccountModal();
    $('btn-add-account2').onclick = () => openAccountModal();
    $('btn-add-category').onclick = () => {
      S().addCategory($('new-category').value, $('new-category-type').value);
      $('new-category').value = ''; renderManage();
    };
    // modal close
    document.querySelectorAll('[data-close]').forEach((el) => el.onclick = closeModal);
    // dashboard chart selectors
    $('pie-range').onchange = renderDashboard;
    $('bar-granularity').onchange = renderDashboard;
    // filters
    ['f-search', 'f-account', 'f-category', 'f-from', 'f-to', 'f-min', 'f-max'].forEach((id) =>
      $(id).addEventListener('input', renderTransactions));
    $('f-clear').onclick = () => {
      ['f-search', 'f-account', 'f-category', 'f-from', 'f-to', 'f-min', 'f-max'].forEach((id) => ($(id).value = ''));
      renderTransactions();
    };
    // export
    $('btn-export-json').onclick = exportJSON;
    $('btn-export-csv').onclick = exportCSV;
    $('btn-open-settings').onclick = () => P.app.openSettings();
    // delegated clicks in manage
    $('view-manage').addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.editAcct) openAccountModal(S().account(t.dataset.editAcct));
      else if (t.dataset.payCc) openPayCCModal(t.dataset.payCc);
      else if (t.dataset.delCat) { S().deleteCategory(t.dataset.delCat); renderManage(); }
      else if (t.dataset.delRec) { S().deleteRecurring(t.dataset.delRec); renderManage(); }
    });
    // topbar
    $('btn-sync').onclick = () => S().sync();
    $('btn-theme').onclick = () => P.app.toggleTheme();
    $('btn-lock').onclick = () => P.app.lock();
    $('nav-lock').onclick = () => P.app.lock();
  }

  P.ui = { wire, show, refresh, toast, closeModal, openTxnModal, exportJSON, exportCSV };
})(window.Paisa);
