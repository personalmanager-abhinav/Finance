/* insights.js — savings rate, runway, and plain-language auto-insights.
 * All figures exclude transfers. Attaches to window.Paisa.insights. */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';
  const S = () => P.store;

  // Spend per category within a date range (expenses only).
  function catSpend(fromISO, toISO) {
    const out = {};
    S().state.transactions.forEach((t) => {
      if (t.type !== 'expense') return;
      if (fromISO && t.date < fromISO) return;
      if (toISO && t.date > toISO) return;
      out[t.category || 'Other'] = (out[t.category || 'Other'] || 0) + t.amount;
    });
    return out;
  }

  P.insights = {
    // KPI block for the current month + rolling figures.
    kpis() {
      const st = S();
      const cur = st.monthRange(0);
      const curSum = st.sumIn(cur.from, cur.to);
      const rate = st.savingsRate(cur.from, cur.to);       // this month
      const runway = st.runwayMonths();
      return {
        monthLabel: cur.label,
        income: curSum.income,
        expense: curSum.expense,
        net: curSum.net,
        savingsRate: rate,            // fraction or null
        runway: runway,               // months or null
        avgMonthlyExpense: st.monthlyExpenseAvg(3)
      };
    },

    // Array of short plain-language strings.
    notes() {
      const st = S();
      const out = [];
      const cur = st.monthRange(0);
      const prev = st.monthRange(-1);
      const curSum = st.sumIn(cur.from, cur.to);
      const prevSum = st.sumIn(prev.from, prev.to);

      // 1. Overall spend vs last month
      if (prevSum.expense > 0) {
        const diff = curSum.expense - prevSum.expense;
        const pct = Math.round((diff / prevSum.expense) * 100);
        if (Math.abs(pct) >= 3) {
          out.push(`You've spent ${P.fmt.money(curSum.expense)} this month — ${Math.abs(pct)}% ${diff >= 0 ? 'more' : 'less'} than last month.`);
        }
      } else if (curSum.expense > 0) {
        out.push(`You've spent ${P.fmt.money(curSum.expense)} so far this month.`);
      }

      // 2. Savings rate note
      const rate = st.savingsRate(cur.from, cur.to);
      if (rate != null) {
        if (rate >= 0) out.push(`You're saving ${Math.round(rate * 100)}% of income this month.`);
        else out.push(`You're spending ${P.fmt.money(-curSum.net)} more than you earned this month.`);
      }

      // 3. Biggest category mover vs 3-month average
      const curCat = catSpend(cur.from, cur.to);
      // build 3-mo average per category (prev 3 full months)
      const avgCat = {};
      for (let i = 1; i <= 3; i++) {
        const r = st.monthRange(-i);
        const c = catSpend(r.from, r.to);
        Object.keys(c).forEach((k) => { avgCat[k] = (avgCat[k] || 0) + c[k] / 3; });
      }
      let bestCat = null, bestDelta = 0;
      Object.keys(curCat).forEach((k) => {
        const base = avgCat[k] || 0;
        const delta = curCat[k] - base;
        if (base > 0 && Math.abs(delta) > Math.abs(bestDelta)) { bestDelta = delta; bestCat = k; }
      });
      if (bestCat) {
        const base = avgCat[bestCat] || 0;
        const pct = Math.round((bestDelta / base) * 100);
        if (Math.abs(pct) >= 15) {
          out.push(`${bestCat} is ${bestDelta >= 0 ? 'up' : 'down'} ${Math.abs(pct)}% vs your 3-month average.`);
        }
      }

      // 4. Top category this month
      const topK = Object.keys(curCat).sort((a, b) => curCat[b] - curCat[a])[0];
      if (topK) out.push(`Biggest category this month: ${topK} (${P.fmt.money(curCat[topK])}).`);

      // 5. Runway
      const runway = st.runwayMonths();
      if (runway != null && isFinite(runway)) {
        out.push(`At your recent pace, current balances cover about ${runway.toFixed(1)} month${runway >= 1.95 || runway < 1 ? 's' : ''} of expenses.`);
      }

      // 6. Upcoming CC dues
      const dues = st.totalDues();
      if (dues > 0) out.push(`You owe ${P.fmt.money(dues)} across credit cards — mark payments when you clear them.`);

      if (!out.length) out.push('Add a few transactions to start seeing insights here.');
      return out;
    }
  };
})(window.Paisa);
