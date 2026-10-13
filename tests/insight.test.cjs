const assert = require('node:assert/strict');
const { analyzeCandle } = require('../assets/insight.js');

function risingBars(count) {
  return Array.from({ length: count }, (_, index) => ({
    t: 1_700_000_000_000 + index * 60_000,
    o: 100 + index,
    h: 102 + index,
    l: 99 + index,
    c: 101 + index,
    v: index === count - 1 ? 220 : 100
  }));
}

const bars = risingBars(40);
const selected = analyzeCandle(bars, 39, { historical: true });
assert.equal(selected.tone, 'positive');
assert.match(selected.evidence.join(' '), /成交额.*2\.2 倍/);
assert.match(selected.evidence.join(' '), /MA5.*MA20/);
assert.match(selected.basis, /该题目已揭晓部分/);

// Appending future data must not change commentary for an earlier bar.
const future = [...bars, {
  t: bars.at(-1).t + 60_000, o: 1, h: 1000, l: 1, c: 1, v: 999999
}];
assert.deepEqual(
  analyzeCandle(future, 39, { historical: true }),
  analyzeCandle(bars, 39, { historical: true })
);

const open = analyzeCandle(bars, 39, {
  durationMs: 60_000,
  now: bars.at(-1).t + 30_000
});
assert.match(open.evidence.join(' '), /尚未收盘/);
assert.equal(open.measures.find(item => item.label === '成交额').value, '未收盘');

const short = analyzeCandle(bars.slice(0, 3), 2, { historical: true });
assert.match(short.evidence.join(' '), /样本不足/);
assert.equal(analyzeCandle(bars, 100), null);

const smallBars = bars.map(row => ({...row,
  o: row.o / 1000, h: row.h / 1000, l: row.l / 1000, c: row.c / 1000}));
const smallInsight = analyzeCandle(smallBars, 39, { historical: true });
assert.equal(smallInsight.measures.find(item => item.label === '收盘').value, '0.14000');
const microBars = bars.map(row => ({...row,
  o: row.o / 1e9, h: row.h / 1e9, l: row.l / 1e9, c: row.c / 1e9}));
assert.match(analyzeCandle(microBars, 39, { historical: true })
  .measures.find(item => item.label === '收盘').value, /e-/);
console.log('Natural-language insight: trend, volume, unfinished bar, missing data, no future leakage: OK');
