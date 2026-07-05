/* format.js — INR formatting, dates, small helpers. Attaches to window.Paisa. */
window.Paisa = window.Paisa || {};
(function (P) {
  'use strict';

  // Indian grouping: ₹1,20,000. Intl 'en-IN' already does lakh/crore grouping.
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  P.fmt = {
    // ₹ with Indian grouping. `signed` prefixes +/-.
    money(n, signed) {
      const v = Number(n) || 0;
      const sign = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : (v < 0 ? '−' : '');
      return sign + '₹' + inr.format(Math.abs(v));
    },
    // Compact for chart axes (₹1.2L, ₹3.4Cr).
    moneyShort(n) {
      const v = Math.abs(Number(n) || 0);
      const s = n < 0 ? '−' : '';
      if (v >= 1e7) return s + '₹' + (v / 1e7).toFixed(v % 1e7 ? 1 : 0) + 'Cr';
      if (v >= 1e5) return s + '₹' + (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + 'L';
      if (v >= 1e3) return s + '₹' + (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + 'k';
      return s + '₹' + v;
    },
    date(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    },
    dayLabel(iso) {
      const d = new Date(iso + 'T00:00:00');
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((today - d) / 86400000);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Yesterday';
      return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    },
    todayISO() {
      const d = new Date();
      const off = d.getTimezoneOffset();
      return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
    }
  };

  // Random id
  P.uid = function () {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  };

  // localStorage keys
  P.LS = {
    token: 'paisa.token',
    gistId: 'paisa.gistId',
    salt: 'paisa.salt',
    verifier: 'paisa.verifier', // encrypted known-string to validate PIN
    theme: 'paisa.theme',
    setupDone: 'paisa.setupDone'
  };
})(window.Paisa);
