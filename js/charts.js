/* charts.js — Chart.js renderers + aggregation. Transfers are excluded from
 * income/expense/category reporting (they are internal moves). */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';
  const charts = {}; // keep instances to destroy on re-render

  const PALETTE = ['#2f9e44', '#7cc78c', '#1e6b30', '#57b368', '#0f4d20', '#a3d9ac',
    '#3f8f52', '#155f28', '#6fbf80', '#245c33', '#8ecf9b', '#12401d'];

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
            { label: 'Income', data: keys.map((k) => inc[k] || 0), backgroundColor: '#2f9e44', borderRadius: 4 },
            { label: 'Expense', data: keys.map((k) => exp[k] || 0), backgroundColor: '#1e6b30', borderRadius: 4 }
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
            borderColor: '#2f9e44', backgroundColor: 'rgba(47,158,68,.12)',
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
    },

    // ----- Spending heatmap: month grid (years x Jan..Dec), shaded by monthly spend -----
    heatmap(elId) {
      const el = document.getElementById(elId);
      const txns = P.store.state.transactions.filter((t) => t.type === 'expense');
      if (!txns.length) { el.innerHTML = '<p class="hint">No expenses yet to map.</p>'; return; }
      const byMonth = {};            // 'YYYY-MM' -> total
      let minY = 9999, maxV = 0;
      const now = new Date(); const curY = now.getFullYear(), curM = now.getMonth();
      txns.forEach((t) => {
        const key = t.date.slice(0, 7);
        byMonth[key] = (byMonth[key] || 0) + t.amount;
        const y = +t.date.slice(0, 4); if (y < minY) minY = y;
      });
      Object.values(byMonth).forEach((v) => { if (v > maxV) maxV = v; });
      if (minY === 9999) minY = curY;

      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const shade = (v) => v > 0 ? `rgba(47,158,68,${(0.15 + 0.85 * Math.min(1, v / (maxV || 1))).toFixed(2)})` : 'var(--surface-2)';
      const strong = (v) => v > 0 && (v / (maxV || 1)) > 0.5;   // white text on dark cells

      let head = '<tr><th></th>' + MON.map((m) => `<th>${m}</th>`).join('') + '</tr>';
      let rows = '';
      for (let y = maxV ? minY : curY; y <= curY; y++) {
        let tds = `<td class="yr">${y}</td>`;
        for (let m = 0; m < 12; m++) {
          const future = (y === curY && m > curM);
          const key = `${y}-${String(m + 1).padStart(2, '0')}`;
          const v = byMonth[key] || 0;
          if (future) { tds += '<td class="mhm-cell empty"></td>'; continue; }
          const label = v > 0 ? P.fmt.moneyShort(v) : '';
          tds += `<td class="mhm-cell${strong(v) ? ' on' : ''}" data-ym="${key}" title="${MON[m]} ${y} · ${P.fmt.money(v)} · tap to open" style="background:${shade(v)}">${label}</td>`;
        }
        rows += `<tr>${tds}</tr>`;
      }
      const legend = `<div class="hm-legend"><span>Less</span>
        <i style="background:var(--surface-2)"></i><i style="background:rgba(47,158,68,.35)"></i>
        <i style="background:rgba(47,158,68,.7)"></i><i style="background:rgba(47,158,68,1)"></i><span>More</span></div>`;
      el.innerHTML = `<div class="hm-scroll"><table class="mhm"><thead>${head}</thead><tbody>${rows}</tbody></table></div>${legend}`;
    },

    // ----- Top payees / merchants (expenses), fallback to category when no payee -----
    topPayees(elId, range) {
      const el = document.getElementById(elId);
      const totals = {};
      P.store.state.transactions.forEach((t) => {
        if (t.type !== 'expense') return;
        if (!withinRange(t.date, range || 'all')) return;
        const key = (t.payee && t.payee.trim()) || (t.category || 'Other');
        totals[key] = (totals[key] || 0) + t.amount;
      });
      const keys = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 12);
      if (!keys.length) { el.innerHTML = '<p class="hint">No expenses in range.</p>'; return; }
      const max = totals[keys[0]];
      el.innerHTML = keys.map((k) => {
        const pct = Math.round((totals[k] / max) * 100);
        return `<div class="bar-row"><div class="bar-label">${esc(k)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="bar-val">${P.fmt.money(totals[k])}</div></div>`;
      }).join('');
    },

    // ----- Month-over-month compare by category (expenses) -----
    momCompare(elId) {
      const el = document.getElementById(elId);
      const st = P.store;
      const cur = st.monthRange(0), prev = st.monthRange(-1);
      const spend = (from, to) => {
        const o = {};
        st.state.transactions.forEach((t) => {
          if (t.type !== 'expense') return;
          if (t.date < from || t.date > to) return;
          o[t.category || 'Other'] = (o[t.category || 'Other'] || 0) + t.amount;
        });
        return o;
      };
      const c = spend(cur.from, cur.to), p = spend(prev.from, prev.to);
      const cats = Array.from(new Set([...Object.keys(c), ...Object.keys(p)]))
        .sort((a, b) => (c[b] || 0) - (c[a] || 0));
      if (!cats.length) { el.innerHTML = '<p class="hint">No expenses to compare yet.</p>'; return; }
      let rows = cats.map((cat) => {
        const cv = c[cat] || 0, pv = p[cat] || 0, d = cv - pv;
        let delta = '—';
        if (pv > 0) { const pct = Math.round((d / pv) * 100); delta = `<span class="${d <= 0 ? 'down' : 'up'}">${d <= 0 ? '▼' : '▲'} ${Math.abs(pct)}%</span>`; }
        else if (cv > 0) delta = '<span class="up">new</span>';
        return `<tr><td>${esc(cat)}</td><td class="num">${P.fmt.money(pv)}</td><td class="num">${P.fmt.money(cv)}</td><td class="num">${delta}</td></tr>`;
      }).join('');
      el.innerHTML = `<table class="bd mom"><thead><tr><th>Category</th><th class="num">${esc(prev.label)}</th><th class="num">${esc(cur.label)}</th><th class="num">Δ</th></tr></thead><tbody>${rows}</tbody></table>`;
    },

    // ----- Money-flow Sankey (SVG): income categories -> Budget -> expense categories + Saved -----
    sankey(elId) {
      const el = document.getElementById(elId);
      const st = P.store.state;
      const income = {}, expense = {};
      st.transactions.forEach((t) => {
        if (t.type === 'income') income[t.category || 'Other'] = (income[t.category || 'Other'] || 0) + t.amount;
        else if (t.type === 'expense') expense[t.category || 'Other'] = (expense[t.category || 'Other'] || 0) + t.amount;
      });
      const TI = Object.values(income).reduce((s, v) => s + v, 0);
      const TE = Object.values(expense).reduce((s, v) => s + v, 0);
      if (TI <= 0 && TE <= 0) { el.innerHTML = '<p class="hint">Add income and expenses to see the flow.</p>'; return; }

      const cap = (obj, n) => {
        const ks = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
        const top = ks.slice(0, n).map((k) => [k, obj[k]]);
        const rest = ks.slice(n).reduce((s, k) => s + obj[k], 0);
        if (rest > 0) top.push(['Other', rest]);
        return top;
      };
      let left = cap(income, 6);      // [name, value]
      let right = cap(expense, 8);
      const M = Math.max(TI, TE) || 1;
      if (TI > TE) right = right.concat([['Saved', TI - TE]]);
      else if (TE > TI) left = left.concat([['Other funds', TE - TI]]);

      const W = 680, H = 340, top = 14, gap = 6, nodeW = 11;
      const leftX = 150, midX0 = W / 2 - 7, rightX = W - 150 - nodeW;
      const cText = themeColors().text, cMut = themeColors().muted;
      const greens = ['#2f9e44', '#57b368', '#1e6b30', '#7cc78c', '#245c33', '#8ecf9b', '#3f8f52', '#155f28', '#6fbf80'];

      const avail = H - top * 2;
      const scaleFor = (nodes) => (avail - gap * (nodes.length - 1)) / M;
      const layout = (nodes, x, scale) => {
        let y = top; return nodes.map((n, i) => { const h = Math.max(2, n[1] * scale); const o = { name: n[0], val: n[1], x, y, h, i }; y += h + gap; return o; });
      };
      const sL = scaleFor(left), sR = scaleFor(right);
      const L = layout(left, leftX, sL), R = layout(right, rightX, sR);
      // middle node split proportionally, top-down, in the same order as L (for inflow) and R (for outflow)
      const midScale = (avail) / M; // single node, no gaps
      const midH = M * midScale;
      const midTop = top + (avail - midH) / 2;

      // inflow slices on middle (matching L order)
      let yin = midTop; const midIn = L.map((n) => { const h = n.val * midScale; const o = { y: yin, h }; yin += h; return o; });
      let yout = midTop; const midOut = R.map((n) => { const h = n.val * midScale; const o = { y: yout, h }; yout += h; return o; });

      const ribbon = (x1, y1a, y1b, x2, y2a, y2b, fill) => {
        const mx = (x1 + x2) / 2;
        return `<path d="M${x1},${y1a} C${mx},${y1a} ${mx},${y2a} ${x2},${y2a} L${x2},${y2b} C${mx},${y2b} ${mx},${y1b} ${x1},${y1b} Z" fill="${fill}" fill-opacity="0.45"/>`;
      };
      let svg = '';
      // left -> middle
      L.forEach((n, i) => { svg += ribbon(n.x + nodeW, n.y, n.y + n.h, midX0, midIn[i].y, midIn[i].y + midIn[i].h, greens[i % greens.length]); });
      // middle -> right
      R.forEach((n, i) => { svg += ribbon(midX0 + 14, midOut[i].y, midOut[i].y + midOut[i].h, n.x, n.y, n.y + n.h, greens[i % greens.length]); });
      // nodes
      const rect = (x, y, h, fill) => `<rect x="${x}" y="${y}" width="${nodeW}" height="${h}" rx="2" fill="${fill}"/>`;
      L.forEach((n, i) => { svg += rect(n.x, n.y, n.h, greens[i % greens.length]); });
      R.forEach((n, i) => { svg += rect(n.x, n.y, n.h, greens[i % greens.length]); });
      svg += `<rect x="${midX0}" y="${midTop}" width="14" height="${midH}" rx="2" fill="${cMut}"/>`;
      // labels
      const label = (x, y, text, val, anchor) => `<text x="${x}" y="${y}" font-size="11" fill="${cText}" text-anchor="${anchor}">${esc(text)}</text><text x="${x}" y="${y + 12}" font-size="10" fill="${cMut}" text-anchor="${anchor}">${P.fmt.moneyShort(val)}</text>`;
      L.forEach((n) => { svg += label(n.x - 6, n.y + n.h / 2, n.name, n.val, 'end'); });
      R.forEach((n) => { svg += label(n.x + nodeW + 6, n.y + n.h / 2, n.name, n.val, 'start'); });
      svg += `<text x="${midX0 + 7}" y="${midTop - 4}" font-size="10" fill="${cMut}" text-anchor="middle">Budget</text>`;

      el.innerHTML = `<div class="sankey-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${svg}</svg></div>`;
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
