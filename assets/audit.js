/* A separate follow-up audit. The original candle commentary is never rewritten here. */
(function (root, create) {
  const audit = create(typeof module === 'object' && module.exports
    ? require('./insight.js') : root.MarketInsight);
  if (typeof module === 'object' && module.exports) module.exports = audit;
  else root.MarketAudit = audit;
})(globalThis, function (insight) {
  'use strict';
  const HORIZON = 5;

  function threshold(rows, index) {
    if (index < 14) return rows[index].c * .003;
    let total = 0;
    for (let i = index - 13; i <= index; i++) {
      const previous = rows[i - 1].c;
      total += Math.max(rows[i].h - rows[i].l,
        Math.abs(rows[i].h - previous), Math.abs(rows[i].l - previous));
    }
    return Math.max(rows[index].c * .003, total / 14 * .5);
  }

  function verify(rows, index, completeCount = rows.length, frozenOriginal = null) {
    if (!Array.isArray(rows) || index < 0 || index >= completeCount ||
        index >= rows.length) return null;
    const original = frozenOriginal || insight.analyzeCandle(rows, index, { historical: true });
    if (!original) return null;
    const direction = original.tone === 'positive' ? 'up' :
      original.tone === 'negative' ? 'down' : null;
    if (index + HORIZON >= completeCount) {
      return { original, direction, ready: false, remaining: index + HORIZON - completeCount + 1 };
    }
    const change = rows[index + HORIZON].c - rows[index].c;
    const limit = threshold(rows, index);
    const outcome = change > limit ? 'up' : change < -limit ? 'down' : 'flat';
    const percent = change / rows[index].c * 100;
    const verdict = !direction ? 'no_call' : outcome === direction ? 'confirmed' : 'missed';
    return { original, direction, ready: true, outcome, percent, verdict,
      endTime: rows[index + HORIZON].t, horizon: HORIZON,
      thresholdPercent: limit / rows[index].c * 100 };
  }

  function wilsonLower(hits, total) {
    const z = 1.96, p = hits / total, z2 = z * z;
    return (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) /
      (1 + z2 / total);
  }

  function reliability(rows, index, current, completeCount = rows.length) {
    if (!current || !current.direction) return null;
    const records = [];
    const end = Math.min(index - HORIZON, completeCount - HORIZON - 1);
    const first = 24 + ((index - 24) % HORIZON + HORIZON) % HORIZON;
    for (let i = first; i <= end; i += HORIZON) {
      const sample = verify(rows, i, completeCount);
      if (sample?.ready && sample.direction) records.push(sample);
    }
    const exact = records.filter(sample => sample.original.title === current.original.title);
    const group = exact.length >= 10 ? exact :
      records.filter(sample => sample.direction === current.direction);
    const scope = exact.length >= 10 ? '同一解读类型' : '同方向提示';
    const hits = group.filter(sample => sample.verdict === 'confirmed').length;
    const count = group.length;
    return { scope, count, hits, rate: count ? hits / count : null,
      qualified: count >= 20 && wilsonLower(hits, count) > .5 };
  }

  return { verify, reliability, HORIZON };
});
