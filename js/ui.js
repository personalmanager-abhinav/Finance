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

  // ---------- reminders popup (iOS-style) ----------
  const REM_DISMISS_KEY = 'paisa.remDismiss';
  function remDismissed() { try { return JSON.parse(localStorage.getItem(REM_DISMISS_KEY) || '{}'); } catch (e) { return {}; } }
  function whenLabel(d) {
    if (d <= 0) return 'Due today';
    if (d === 1) return 'Due tomorrow';
    return 'Due in ' + d + ' days';
  }
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  const CARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>';

  // Show the reminders popup if anything is due within the window and not dismissed today.
  function showReminders() {
    const st = S();
    const today = P.fmt.todayISO();
    const dismissed = remDismissed();
    // Alert thresholds chosen: 5 days, and 1 day/due-day. Surface the window (<=5),
    // but only pop for items at/under 5 days that haven't been dismissed today.
    const items = st.reminders(5).filter((r) => !dismissed[r.key + '|' + today]);
    if (!items.length) return;
    $('rem-sub').textContent = items.length + (items.length === 1 ? ' item due soon' : ' items due soon');
    $('rem-list').innerHTML = items.map((r) => {
      const urgent = r.daysLeft <= 1;
      const ic = r.kind === 'cc' ? CARD : BELL;
      return `<div class="rem-item">
        <div class="rem-ic${urgent ? ' urgent' : ''}">${ic}</div>
        <div class="rem-main"><div class="rem-name">${esc(r.title)}</div>
          <div class="rem-when"><span class="${urgent ? 'urgent' : ''}">${whenLabel(r.daysLeft)}</span> · ${P.fmt.date(r.dueDate)}</div></div>
        <div class="rem-amt">${P.fmt.money(r.amount)}</div></div>`;
    }).join('');
    $('reminder-root').hidden = false;
    const dismissAll = () => {
      const dis = remDismissed();
      items.forEach((r) => { dis[r.key + '|' + today] = 1; });
      // prune old dismissals (keep only today's)
      Object.keys(dis).forEach((k) => { if (!k.endsWith('|' + today)) delete dis[k]; });
      localStorage.setItem(REM_DISMISS_KEY, JSON.stringify(dis));
      $('reminder-root').hidden = true;
    };
    $('rem-done').onclick = dismissAll;
    $('reminder-root').querySelector('[data-rem-close]').onclick = dismissAll;
  }

  // ---------- sync conflict resolver ----------
  function showConflict(conflict) {
    const body = `
      <p class="hint">Your data was changed on another device since this one last synced.
      Choose how to resolve it so nothing is lost.</p>
      <button id="cf-merge" class="btn primary block">Merge both (recommended)</button>
      <button id="cf-mine" class="btn ghost block">Keep this device's version</button>
      <button id="cf-remote" class="btn ghost block">Keep the other device's version</button>
      <div id="cf-msg" class="hint" style="margin-top:10px"></div>`;
    openModal('Sync conflict', body, () => {
      const go = async (choice) => {
        $('cf-msg').textContent = 'Resolving…';
        try { await S().resolveConflict(choice, conflict); toast('Synced'); closeModal(); }
        catch (e) { $('cf-msg').textContent = 'Failed: ' + (e.message || e); }
      };
      $('cf-merge').onclick = () => go('merge');
      $('cf-mine').onclick = () => go('mine');
      $('cf-remote').onclick = () => go('remote');
    });
  }

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
    const typeBtn = document.querySelector('#f-type-seg button.active');
    return {
      q: $('f-search').value.trim().toLowerCase(),
      type: typeBtn ? typeBtn.dataset.ftype : '',
      acc: $('f-account').value,
      cat: $('f-category').value,
      from: $('f-from').value,
      to: $('f-to').value,
      min: $('f-min').value ? Number($('f-min').value) : null,
      max: $('f-max').value ? Number($('f-max').value) : null,
      sort: $('f-sort').value
    };
  }
  // Set the from/to date inputs from a preset key.
  function applyDatePreset(preset) {
    const iso = (d) => { const o = d.getTimezoneOffset(); return new Date(d.getTime() - o * 60000).toISOString().slice(0, 10); };
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
    let from = '', to = '';
    if (preset === 'week') {
      const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      from = iso(mon); to = iso(now);
    } else if (preset === 'month') {
      from = iso(new Date(y, m, 1)); to = iso(new Date(y, m + 1, 0));
    } else if (preset === 'lastmonth') {
      from = iso(new Date(y, m - 1, 1)); to = iso(new Date(y, m, 0));
    } else if (preset === 'year') {
      from = iso(new Date(y, 0, 1)); to = iso(new Date(y, 11, 31));
    } // 'all' leaves both blank
    $('f-from').value = from; $('f-to').value = to;
  }

  function applyFilters(list, f) {
    return list.filter((t) => {
      if (f.type && t.type !== f.type) return false;
      if (f.acc && t.accountId !== f.acc && t.toAccountId !== f.acc) return false;
      if (f.cat && t.category !== f.cat) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.min != null && t.amount < f.min) return false;
      if (f.max != null && t.amount > f.max) return false;
      if (f.q) {
        const acc = S().account(t.accountId);
        const toAcc = t.toAccountId ? S().account(t.toAccountId) : null;
        const hay = [t.category, t.payee, t.note, t.type,
          acc && acc.name, toAcc && toAcc.name, String(t.amount)]
          .filter(Boolean).join(' ').toLowerCase();
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
    const byDateDesc = (a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0) || (b.id < a.id ? -1 : 1);
    const sorters = {
      'date-desc': byDateDesc,
      'date-asc': (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : 1),
      'amt-desc': (a, b) => b.amount - a.amount || byDateDesc(a, b),
      'amt-asc': (a, b) => a.amount - b.amount || byDateDesc(a, b)
    };
    const list = applyFilters(st.state.transactions.slice(), f).sort(sorters[f.sort] || byDateDesc);
    const grouped = (f.sort || 'date-desc').startsWith('date');

    // Running balance across the filtered results (chronological).
    // If a single account is filtered, it reflects that account's inflow/outflow;
    // otherwise it is the net-worth effect (transfers net to zero).
    const oneAcc = f.acc || null;
    const delta = (t) => {
      if (oneAcc) {
        if (t.type === 'transfer') return (t.toAccountId === oneAcc ? t.amount : 0) - (t.accountId === oneAcc ? t.amount : 0);
        return (t.type === 'income' ? 1 : -1) * t.amount;
      }
      return t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0;
    };
    const runningById = {};
    let run = 0;
    list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : 1))
      .forEach((t) => { run += delta(t); runningById[t.id] = run; });

    let income = 0, expense = 0;
    list.forEach((t) => { if (t.type === 'income') income += t.amount; else if (t.type === 'expense') expense += t.amount; });
    const runLabel = oneAcc ? 'Net change' : 'Net';
    $('txn-summary').innerHTML =
      `<span>${list.length} txns</span><span>Income <b>${P.fmt.money(income)}</b></span>` +
      `<span>Expense <b>${P.fmt.money(expense)}</b></span><span>${runLabel} <b>${P.fmt.money(income - expense)}</b></span>` +
      (oneAcc ? `<span>Running <b>${P.fmt.money(run)}</b></span>` : '');

    const wrap = $('txn-list'); wrap.innerHTML = '';
    if (!list.length) { wrap.innerHTML = '<p class="hint">No transactions match.</p>'; return; }
    let lastDay = null;
    list.forEach((t) => {
      if (grouped && t.date !== lastDay) {
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
      if (t.payee) meta = esc(t.payee) + ' · ' + meta;
      if (t.note) meta += ' · ' + esc(t.note);
      const runHTML = oneAcc ? `<div class="t-run">bal ${P.fmt.money(runningById[t.id])}</div>` : '';
      const row = document.createElement('div');
      row.className = 'txn';
      row.innerHTML = `<div class="t-icon">${icon}</div>
        <div class="t-main"><div class="t-cat">${esc(t.category || (t.type === 'transfer' ? 'Transfer' : 'Uncategorised'))}</div>
        <div class="t-meta">${meta}</div></div>
        <div class="t-amt-wrap"><div class="t-amt ${t.type}">${sign}${P.fmt.money(t.amount)}</div>${runHTML}</div>`;
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

    // goals
    $('manage-goals').innerHTML = st.state.goals.map((g) => {
      const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
      return `<div class="row-item"><div class="ri-main"><b>${esc(g.name)}</b>
        <div class="ri-sub">${P.fmt.money(g.current)} / ${P.fmt.money(g.target)} · ${pct}%${g.deadline ? ' · by ' + P.fmt.date(g.deadline) : ''}</div></div>
        <button class="btn ghost" data-goal-edit="${g.id}">Edit</button></div>`;
    }).join('') || '<p class="hint">No goals yet.</p>';

    // templates
    $('manage-templates').innerHTML = st.state.templates.map((t) => {
      const acc = st.account(t.accountId);
      return `<div class="row-item"><div class="ri-main"><b>${esc(t.label)}</b>
        <div class="ri-sub">${t.type} · ${P.fmt.money(t.amount)}${t.category ? ' · ' + esc(t.category) : ''}${acc ? ' · ' + esc(acc.name) : ''}</div></div>
        <button class="btn ghost danger" data-del-tpl="${t.id}">Delete</button></div>`;
    }).join('') || '<p class="hint">No templates. Add frequent transactions for one-tap entry.</p>';

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

  // ---------- goal modal ----------
  function openGoalModal(existing) {
    const g = existing || { name: '', target: '', current: '', deadline: '' };
    const body = `
      <label>Goal name</label>
      <input id="g-name" type="text" placeholder="e.g. Emergency fund" value="${esc(g.name)}" />
      <label>Target amount (₹)</label>
      <input id="g-target" type="number" step="0.01" placeholder="0" value="${g.target || ''}" />
      <label>Already saved (₹)</label>
      <input id="g-current" type="number" step="0.01" placeholder="0" value="${g.current || ''}" />
      <label>Target date (optional)</label>
      <input id="g-deadline" type="date" value="${g.deadline || ''}" />
      <button id="g-save" class="btn primary block">${existing ? 'Save goal' : 'Add goal'}</button>
      ${existing ? '<button id="g-delete" class="btn ghost danger block">Delete goal</button>' : ''}`;
    openModal(existing ? 'Edit goal' : 'New goal', body, () => {
      $('g-save').onclick = () => {
        const data = { name: $('g-name').value.trim(), target: Number($('g-target').value) || 0,
          current: Number($('g-current').value) || 0, deadline: $('g-deadline').value || null };
        if (!data.name) { toast('Name required'); return; }
        if (data.target <= 0) { toast('Set a target amount'); return; }
        if (existing) S().updateGoal(existing.id, data); else S().addGoal(data);
        toast('Saved'); closeModal(); refresh();
      };
      if (existing) $('g-delete').onclick = () => { S().deleteGoal(existing.id); toast('Deleted'); closeModal(); refresh(); };
    });
  }
  function openContributeModal(goalId) {
    const g = S().state.goals.find((x) => x.id === goalId); if (!g) return;
    const remaining = Math.max(0, g.target - g.current);
    const body = `
      <p class="hint">Add to <b>${esc(g.name)}</b>. ${P.fmt.money(remaining)} to go.</p>
      <label>Amount (₹)</label>
      <input id="c-amount" type="number" step="0.01" placeholder="0" value="${remaining || ''}" />
      <button id="c-save" class="btn primary block">Add contribution</button>`;
    openModal('Contribute to goal', body, () => {
      $('c-save').onclick = () => {
        const amt = Number($('c-amount').value);
        if (!amt) { toast('Enter amount'); return; }
        S().contributeGoal(goalId, amt); toast('Added'); closeModal(); refresh();
      };
    });
  }

  // ---------- template modal ----------
  function openTemplateModal() {
    const st = S();
    if (!st.state.accounts.length) { toast('Add an account first'); openAccountModal(); return; }
    const body = `
      <label>Label</label>
      <input id="tp-label" type="text" placeholder="e.g. Morning coffee" />
      <div class="seg type">
        <button data-type="expense" class="active">Expense</button>
        <button data-type="income">Income</button>
      </div>
      <label>Amount (₹)</label>
      <input id="tp-amount" type="number" step="0.01" placeholder="0" />
      <label>Category</label>
      <select id="tp-category">${categoryOptions('expense', '')}</select>
      <label>Account</label>
      <select id="tp-account">${accountOptions(st.state.accounts[0].id)}</select>
      <label>Payee (optional)</label>
      <input id="tp-payee" type="text" placeholder="e.g. Starbucks" />
      <button id="tp-save" class="btn primary block">Save template</button>`;
    openModal('New quick-add template', body, (root) => {
      let type = 'expense';
      root.querySelectorAll('.seg.type button').forEach((b) => b.onclick = () => {
        type = b.dataset.type;
        root.querySelectorAll('.seg.type button').forEach((x) => x.classList.toggle('active', x.dataset.type === type));
        $('tp-category').innerHTML = categoryOptions(type, '');
      });
      $('tp-save').onclick = () => {
        const label = $('tp-label').value.trim();
        const amount = Number($('tp-amount').value);
        if (!label) { toast('Label required'); return; }
        if (!amount || amount <= 0) { toast('Enter amount'); return; }
        st.addTemplate({ label, type, amount, category: $('tp-category').value,
          accountId: $('tp-account').value, payee: $('tp-payee').value.trim() });
        toast('Template saved'); closeModal(); refresh();
      };
    });
  }

  // ---------- calendar day view (drill-down from heatmap) ----------
  function openMonthCalendar(ym) {
    const st = S();
    const [y, mo] = ym.split('-').map(Number);
    const first = new Date(y, mo - 1, 1);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Mon-start offset
    const title = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    // per-day expense totals for shading
    const byDay = {};
    let maxV = 0;
    st.state.transactions.forEach((t) => {
      if (t.type === 'expense' && t.date.slice(0, 7) === ym) {
        byDay[t.date] = (byDay[t.date] || 0) + t.amount;
        if (byDay[t.date] > maxV) maxV = byDay[t.date];
      }
    });
    const iso = (d) => `${ym}-${String(d).padStart(2, '0')}`;
    const shade = (v) => v > 0 ? `rgba(47,158,68,${(0.15 + 0.85 * Math.min(1, v / (maxV || 1))).toFixed(2)})` : 'transparent';
    const strong = (v) => v > 0 && v / (maxV || 1) > 0.5;

    const dows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    let cells = dows.map((d) => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < lead; i++) cells += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const key = iso(d); const v = byDay[key] || 0;
      cells += `<div class="cal-cell${strong(v) ? ' on' : ''}" data-day="${key}" style="background:${shade(v)}">
        <span class="cal-d">${d}</span>${v > 0 ? `<span class="cal-v">${P.fmt.moneyShort(v)}</span>` : ''}</div>`;
    }
    const body = `<div class="cal-grid">${cells}</div><div id="cal-detail" class="cal-detail"><p class="hint">Tap a day to see its transactions.</p></div>`;
    openModal(title, body, (root) => {
      root.querySelector('.cal-grid').addEventListener('click', (e) => {
        const c = e.target.closest('[data-day]'); if (!c) return;
        root.querySelectorAll('.cal-cell').forEach((x) => x.classList.remove('sel'));
        c.classList.add('sel');
        renderDayDetail(c.dataset.day);
      });
    });
  }
  function renderDayDetail(dateISO) {
    const st = S();
    const items = st.state.transactions.filter((t) => t.date === dateISO)
      .sort((a, b) => b.amount - a.amount);
    const el = $('cal-detail');
    if (!items.length) { el.innerHTML = `<p class="hint">${P.fmt.date(dateISO)} — no transactions.</p>`; return; }
    let inc = 0, exp = 0;
    items.forEach((t) => { if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') exp += t.amount; });
    const rows = items.map((t) => {
      const acc = st.account(t.accountId);
      const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
      const label = t.payee || t.category || (t.type === 'transfer' ? 'Transfer' : 'Uncategorised');
      return `<div class="cal-txn"><div><b>${esc(label)}</b><div class="ri-sub">${esc(t.category || '')}${acc ? ' · ' + esc(acc.name) : ''}</div></div>
        <div class="t-amt ${t.type}">${sign}${P.fmt.money(t.amount)}</div></div>`;
    }).join('');
    el.innerHTML = `<div class="cal-detail-head">${P.fmt.date(dateISO)}
      <span class="muted">· in ${P.fmt.money(inc)} · out ${P.fmt.money(exp)}</span></div>${rows}`;
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
    const rows = [['Date', 'Type', 'Category', 'Account', 'To Account', 'Payee', 'Amount', 'Note']];
    st.state.transactions.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach((t) => {
      rows.push([t.date, t.type, t.category || '', acctName(t.accountId), t.toAccountId ? acctName(t.toAccountId) : '',
        (t.payee || '').replace(/"/g, '""'), t.amount, (t.note || '').replace(/"/g, '""')]);
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
    $('payee-range').onchange = renderInsights;
    // heatmap month -> calendar drill-down
    $('ins-heatmap').addEventListener('click', (e) => {
      const c = e.target.closest('[data-ym]'); if (c) openMonthCalendar(c.dataset.ym);
    });
    // goals + templates add buttons
    $('btn-add-goal').onclick = () => openGoalModal();
    $('btn-add-template').onclick = () => openTemplateModal();
    // dashboard delegated clicks (templates + goals)
    $('view-dashboard').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tpl],[data-goal-add],[data-goal-edit]') || e.target;
      if (t.id === 'tpl-add-inline') { openTemplateModal(); return; }
      if (t.dataset.tpl) { S().applyTemplate(t.dataset.tpl); toast('Added'); refresh(); }
      else if (t.dataset.goalAdd) openContributeModal(t.dataset.goalAdd);
      else if (t.dataset.goalEdit) openGoalModal(S().state.goals.find((g) => g.id === t.dataset.goalEdit));
    });
    // filters
    ['f-search', 'f-account', 'f-category', 'f-from', 'f-to', 'f-min', 'f-max'].forEach((id) =>
      $(id).addEventListener('input', renderTransactions));
    $('f-sort').addEventListener('change', renderTransactions);
    // quick date presets
    $('date-presets').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      applyDatePreset(b.dataset.preset);
      $('date-presets').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      renderTransactions();
    });
    // income/expense/transfer segmented filter
    $('f-type-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $('f-type-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      renderTransactions();
    });
    $('f-clear').onclick = () => {
      ['f-search', 'f-account', 'f-category', 'f-from', 'f-to', 'f-min', 'f-max'].forEach((id) => ($(id).value = ''));
      $('f-sort').value = 'date-desc';
      $('f-type-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.ftype === ''));
      $('date-presets').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
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
      else if (t.dataset.goalEdit) openGoalModal(S().state.goals.find((g) => g.id === t.dataset.goalEdit));
      else if (t.dataset.delTpl) { S().deleteTemplate(t.dataset.delTpl); renderManage(); }
    });
    // topbar
    $('btn-sync').onclick = () => S().sync();
    $('btn-theme').onclick = () => P.app.toggleTheme();
    $('btn-lock').onclick = () => P.app.lock();
  }

  P.ui = { wire, show, refresh, toast, closeModal, openTxnModal, exportJSON, exportCSV, showReminders, showConflict };
})(window.Paisa);
