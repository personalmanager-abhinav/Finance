/* charts.js — Chart.js renderers + aggregation. Transfers are excluded from
 * income/expense/category reporting (they are internal moves). */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';
  const charts = {}; // keep instances to destroy on re-render

  const PALETTE = ['#1e2a52', '#a63a2b', '#1f6e4e', '#7a4a00', '#3a5a8a', '#8a6d3b',
    '#6b4a7a', '#4a7a6b', '#a5744a', '#5a6a4a', '#7a3a5a', '#3a6a7a'];

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      text: cs.getPropertyValue('--text').trim() || '#111',
      grid: cs.getPropertyValue('--border').trim() || '#ddd',
      muted: cs.getPropertyValue('--muted').trim() || '#888'
    };
  }

  function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

  // ---- period keys ----
  function periodKey(iso, gran) {
    const d = new Date(iso + 'T00:00:00');
    if (gran === 'day') return iso;
    if (gran === 'year') return String(d.getFullYear());
    if (gran === 'week') {
      const t = new Date(d); t.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
      return t.toISOString().slice(0, 10);
    }
    return iso.slice(0, 7); // month YYYY-MM
  }
  function periodLabel(key, gran) {
    if (gran === 'year') return key;
    if (gran === 'day' || gran === 'week') {
      const d = new Date(key + 'T00:00:00');
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    const [y, m] = key.split('-');
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  }

  function withinRange(iso, range) {
    if (range === 'all') return true;
    const d = new Date(iso + 'T00:00:00'); const now = new Date();
    if (range === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (range === 'year') return d.getFullYear() === now.getFullYear();
    return true;
  }

  P.charts = {
    // Category pie (expenses only) for the selected range.
    category(canvasId, range) {
      const S = P.store.state;
      const totals = {};
      S.transactions.forEach((t) => {
        if (t.type !== 'expense') return;
        if (!withinRange(t.date, range)) return;
        totals[t.category || 'Other'] = (totals[t.category || 'Other'] || 0) + t.amount;
      });
      const labels = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
      const data = labels.map((l) => totals[l]);
      const c = themeColors();
      destroy(canvasId);
      const ctx = document.getElementById(canvasId);
      if (!labels.length) { blank(ctx, 'No expenses in range'); return; }
      charts[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }] },
        options: {
          plugins: {
            legend: { position: 'bottom', labels: { color: c.text, boxWidth: 12, padding: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: (x) => x.label + ': ' + P.fmt.money(x.parsed) } }
          },
          cutout: '58%'
        }
      });
    },

    // Income vs expense grouped bar by granularity.
    trend(canvasId, gran) {
      const S = P.store.state;
      const inc = {}, exp = {};
      S.transactions.forEach((t) => {
        if (t.type === 'transfer') return;
        const k = periodKey(t.date, gran);
        if (t.type === 'income') inc[k] = (inc[k] || 0) + t.amount;
        else exp[k] = (exp[k] || 0) + t.amount;
      });
      let keys = Array.from(new Set([...Object.keys(inc), ...Object.keys(exp)])).sort();
      keys = keys.slice(-12); // last 12 periods
      const c = themeColors();
      destroy(canvasId);
      const ctx = document.getElementById(canvasId);
      if (!keys.length) { blank(ctx, 'No data yet'); return; }
      charts[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: keys.map((k) => periodLabel(k, gran)),
          datasets: [
            { label: 'Income', data: keys.map((k) => inc[k] || 0), backgroundColor: '#1f6e4e', borderRadius: 2 },
            { label: 'Expense', data: keys.map((k) => exp[k] || 0), backgroundColor: '#a63a2b', borderRadius: 2 }
          ]
        },
        options: {
          plugins: { legend: { labels: { color: c.text, font: { size: 11 } } },
            tooltip: { callbacks: { label: (x) => x.dataset.label + ': ' + P.fmt.money(x.parsed.y) } } },
          scales: {
            x: { ticks: { color: c.muted, font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: c.muted, font: { size: 10 }, callback: (v) => P.fmt.moneyShort(v) }, grid: { color: c.grid } }
          }
        }
      });
    },

    // Net worth over time = opening balances + cumulative(income − expense) by day.
    networth(canvasId) {
      const S = P.store.state;
      const baseline = S.accounts.reduce((s, a) => s + (Number(a.openingBalance) || 0), 0);
      const byDay = {};
      S.transactions.forEach((t) => {
        if (t.type === 'transfer') return;
        const delta = t.type === 'income' ? t.amount : -t.amount;
        byDay[t.date] = (byDay[t.date] || 0) + delta;
      });
      const days = Object.keys(byDay).sort();
      const c = themeColors();
      destroy(canvasId);
      const ctx = document.getElementById(canvasId);
      if (!days.length) { blank(ctx, 'No data yet'); return; }
      let run = baseline;
      const points = days.map((d) => { run += byDay[d]; return { x: d, y: run }; });
      // prepend baseline point
      points.unshift({ x: days[0], y: baseline });
      charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: points.map((p) => P.fmt.date(p.x)),
          datasets: [{
            label: 'Net worth', data: points.map((p) => p.y),
            borderColor: '#1e2a52', backgroundColor: 'rgba(30,42,82,.10)',
            fill: true, tension: .25, pointRadius: 0, borderWidth: 2
          }]
        },
        options: {
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: (x) => P.fmt.money(x.parsed.y) } } },
          scales: {
            x: { ticks: { color: c.muted, maxTicksLimit: 6, font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: c.muted, font: { size: 10 }, callback: (v) => P.fmt.moneyShort(v) }, grid: { color: c.grid } }
          }
        }
      });
    },

    // "Payee-level" stand-in: spend grouped by account, then category.
    breakdown(elId, range) {
      const S = P.store.state;
      const byAcc = {}; // accId -> { cat -> amount }
      S.transactions.forEach((t) => {
        if (t.type !== 'expense') return;
        if (!withinRange(t.date, range || 'month')) return;
        const a = t.accountId || 'unknown';
        byAcc[a] = byAcc[a] || {};
        byAcc[a][t.category || 'Other'] = (byAcc[a][t.category || 'Other'] || 0) + t.amount;
      });
      const el = document.getElementById(elId);
      const accIds = Object.keys(byAcc);
      if (!accIds.length) { el.innerHTML = '<p class="hint">No expenses in range.</p>'; return; }
      let html = '<table class="bd"><tbody>';
      accIds.forEach((aid) => {
        const acc = P.store.account(aid);
        const cats = byAcc[aid];
        const sub = Object.values(cats).reduce((s, v) => s + v, 0);
        html += `<tr class="group"><td>${acc ? esc(acc.name) : 'Unknown'}</td><td class="num">${P.fmt.money(sub)}</td></tr>`;
        Object.keys(cats).sort((a, b) => cats[b] - cats[a]).forEach((cat) => {
          html += `<tr><td>&nbsp;&nbsp;${esc(cat)}</td><td class="num">${P.fmt.money(cats[cat])}</td></tr>`;
        });
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    }
  };

  function blank(canvas, msg) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = themeColors().muted;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg, canvas.width / 2, 40);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
  P.esc = esc;
})(window.Paisa);
